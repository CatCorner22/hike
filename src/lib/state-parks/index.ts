export interface StateParkCampground {
  externalId: string;
  name: string;
  latitude: number;
  longitude: number;
  state: string;
  parkName?: string;
  campingType: "developed_tent" | "rv" | "backcountry" | "walk_in";
  description?: string;
  amenities?: Record<string, unknown>;
  reservationUrl?: string;
}

const CA_GEOJSON_URL =
  "https://services3.arcgis.com/T4QMspdeLBEk9Fas/arcgis/rest/services/Campgrounds/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson";

const CO_GEOJSON_URL =
  "https://services1.arcgis.com/98TjUMsFsx7gyJtk/arcgis/rest/services/Colorado_State_Parks_Campgrounds/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson";

const WA_GEOJSON_URL =
  "https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/WA_State_Parks_Campgrounds/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson";

async function fetchGeoJsonCampgrounds(
  url: string,
  state: string,
): Promise<StateParkCampground[]> {
  try {
    const response = await fetch(url, { next: { revalidate: 604800 } });
    if (!response.ok) return [];
    const data = await response.json();
    const features = data.features || [];

    return features
      .map((feature: {
        properties: Record<string, unknown>;
        geometry?: { coordinates: [number, number] };
      }) => {
        const props = feature.properties;
        const coords = feature.geometry?.coordinates;
        if (!coords) return null;

        const [lng, lat] = coords;
        const name =
          (props.SITE_NAME as string) ||
          (props.camping_unit_name as string) ||
          (props.CAMPGROUND as string) ||
          (props.Name as string) ||
          (props.name as string) ||
          "Campground";

        const parkName =
          (props.Park_Unit as string) ||
          (props.PARK_NAME as string) ||
          (props.park_name as string) ||
          (props.UNIT_NAME as string);

        const typeRaw = String(
          props.EQUIPMENT_TYPE ||
            props.campsite_type_name ||
            props.SITE_TYPE ||
            "",
        ).toLowerCase();

        let campingType: StateParkCampground["campingType"] = "developed_tent";
        if (typeRaw.includes("rv") || typeRaw.includes("trailer")) {
          campingType = "rv";
        } else if (typeRaw.includes("walk") || typeRaw.includes("hike")) {
          campingType = "walk_in";
        } else if (typeRaw.includes("backcountry") || typeRaw.includes("primitive")) {
          campingType = "backcountry";
        }

        return {
          externalId: `state-${state}-${props.OBJECTID || props.objectid || props.SITE_ID || name}`,
          name: String(name),
          latitude: lat,
          longitude: lng,
          state,
          parkName: parkName ? String(parkName) : undefined,
          campingType,
          description: parkName ? `${name} at ${parkName}` : undefined,
          amenities: props,
          reservationUrl: (props.URL as string) || undefined,
        } satisfies StateParkCampground;
      })
      .filter(Boolean) as StateParkCampground[];
  } catch {
    return [];
  }
}

export async function fetchCaliforniaCampgrounds() {
  return fetchGeoJsonCampgrounds(CA_GEOJSON_URL, "CA");
}

export async function fetchColoradoCampgrounds() {
  return fetchGeoJsonCampgrounds(CO_GEOJSON_URL, "CO");
}

export async function fetchWashingtonCampgrounds() {
  return fetchGeoJsonCampgrounds(WA_GEOJSON_URL, "WA");
}

export async function fetchAllStateCampgrounds(): Promise<StateParkCampground[]> {
  const [ca, co, wa] = await Promise.all([
    fetchCaliforniaCampgrounds(),
    fetchColoradoCampgrounds(),
    fetchWashingtonCampgrounds(),
  ]);
  return [...ca, ...co, ...wa];
}

export function stateCampgroundToRecord(camp: StateParkCampground) {
  return {
    externalId: camp.externalId,
    name: camp.name,
    latitude: camp.latitude,
    longitude: camp.longitude,
    state: camp.state,
    parkCode: null as string | null,
    parkName: camp.parkName ?? null,
    source: "state" as const,
    campingType: camp.campingType,
    description: camp.description ?? null,
    amenities: camp.amenities ?? null,
    reservationUrl: camp.reservationUrl ?? null,
    permitRequired: camp.campingType === "backcountry",
    fees: null,
    metadata: { state: camp.state },
  };
}
