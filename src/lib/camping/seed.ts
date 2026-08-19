export interface SeedCampground {
  id: string;
  externalId: string;
  name: string;
  latitude: number;
  longitude: number;
  state: string;
  parkCode: string | null;
  parkName: string;
  source: "nps" | "ridb" | "state" | "osm";
  campingType: "developed_tent" | "rv" | "backcountry" | "walk_in";
  description: string;
  amenities: Record<string, unknown>;
  reservationUrl: string;
  permitRequired: boolean;
  fees: unknown;
  metadata: Record<string, unknown>;
}

export const SEED_CAMPGROUNDS: SeedCampground[] = [
  {
    id: "seed-yosemite-upper-pines",
    externalId: "seed-yosemite-upper-pines",
    name: "Upper Pines Campground",
    latitude: 37.7362,
    longitude: -119.5626,
    state: "CA",
    parkCode: "yose",
    parkName: "Yosemite National Park",
    source: "nps",
    campingType: "developed_tent",
    description:
      "Developed tent and small-RV campground in Yosemite Valley. Reservations required in peak season.",
    amenities: { toilets: true, potableWater: true, bearBoxes: true },
    reservationUrl: "https://www.recreation.gov/camping/campgrounds/232447",
    permitRequired: false,
    fees: null,
    metadata: { seed: true },
  },
  {
    id: "seed-yosemite-little-yosemite",
    externalId: "seed-yosemite-little-yosemite",
    name: "Little Yosemite Valley Backcountry Camp",
    latitude: 37.7333,
    longitude: -119.5147,
    state: "CA",
    parkCode: "yose",
    parkName: "Yosemite National Park",
    source: "nps",
    campingType: "backcountry",
    description:
      "Wilderness camp on the Half Dome / John Muir Trail corridor. Wilderness permit required.",
    amenities: { toilets: true, bearBoxes: true },
    reservationUrl: "https://www.nps.gov/yose/planyourvisit/wildpermits.htm",
    permitRequired: true,
    fees: null,
    metadata: { seed: true },
  },
  {
    id: "seed-zion-watchman",
    externalId: "seed-zion-watchman",
    name: "Watchman Campground",
    latitude: 37.1984,
    longitude: -112.9865,
    state: "UT",
    parkCode: "zion",
    parkName: "Zion National Park",
    source: "nps",
    campingType: "developed_tent",
    description: "Tent and electric sites near the Zion Canyon Visitor Center.",
    amenities: { toilets: true, potableWater: true, electric: true },
    reservationUrl: "https://www.recreation.gov/camping/campgrounds/232445",
    permitRequired: false,
    fees: null,
    metadata: { seed: true },
  },
  {
    id: "seed-zion-la-verkin",
    externalId: "seed-zion-la-verkin",
    name: "La Verkin Creek Wilderness Camps",
    latitude: 37.2841,
    longitude: -113.109,
    state: "UT",
    parkCode: "zion",
    parkName: "Zion National Park",
    source: "nps",
    campingType: "backcountry",
    description: "Designated wilderness camps along the Kolob Canyons / La Verkin Creek trail.",
    amenities: {},
    reservationUrl: "https://www.nps.gov/zion/planyourvisit/backpacking.htm",
    permitRequired: true,
    fees: null,
    metadata: { seed: true },
  },
  {
    id: "seed-grand-canyon-mather",
    externalId: "seed-grand-canyon-mather",
    name: "Mather Campground",
    latitude: 36.0493,
    longitude: -112.119,
    state: "AZ",
    parkCode: "grca",
    parkName: "Grand Canyon National Park",
    source: "nps",
    campingType: "developed_tent",
    description: "South Rim tent camping near Grand Canyon Village.",
    amenities: { toilets: true, potableWater: true },
    reservationUrl: "https://www.recreation.gov/camping/campgrounds/232490",
    permitRequired: false,
    fees: null,
    metadata: { seed: true },
  },
  {
    id: "seed-grand-canyon-bright-angel",
    externalId: "seed-grand-canyon-bright-angel",
    name: "Bright Angel Campground",
    latitude: 36.1014,
    longitude: -112.0951,
    state: "AZ",
    parkCode: "grca",
    parkName: "Grand Canyon National Park",
    source: "nps",
    campingType: "backcountry",
    description: "Inner-canyon camp at Phantom Ranch. Backcountry permit required.",
    amenities: { toilets: true, potableWater: true },
    reservationUrl: "https://www.nps.gov/grca/planyourvisit/backcountry-permit.htm",
    permitRequired: true,
    fees: null,
    metadata: { seed: true },
  },
  {
    id: "seed-rmnp-glacier-basin",
    externalId: "seed-rmnp-glacier-basin",
    name: "Glacier Basin Campground",
    latitude: 40.3284,
    longitude: -105.5956,
    state: "CO",
    parkCode: "romo",
    parkName: "Rocky Mountain National Park",
    source: "nps",
    campingType: "developed_tent",
    description: "Developed campground near Bear Lake Road.",
    amenities: { toilets: true, potableWater: true },
    reservationUrl: "https://www.recreation.gov/camping/campgrounds/232463",
    permitRequired: false,
    fees: null,
    metadata: { seed: true },
  },
  {
    id: "seed-rmnp-boulderfield",
    externalId: "seed-rmnp-boulderfield",
    name: "Boulder Field Backcountry Site",
    latitude: 40.2597,
    longitude: -105.615,
    state: "CO",
    parkCode: "romo",
    parkName: "Rocky Mountain National Park",
    source: "nps",
    campingType: "backcountry",
    description: "High-elevation designated site on the Longs Peak / Keyhole Route approach.",
    amenities: {},
    reservationUrl: "https://www.nps.gov/romo/planyourvisit/wilderness-camping.htm",
    permitRequired: true,
    fees: null,
    metadata: { seed: true },
  },
  {
    id: "seed-olympic-hoh",
    externalId: "seed-olympic-hoh",
    name: "Hoh Campground",
    latitude: 47.8603,
    longitude: -123.9346,
    state: "WA",
    parkCode: "olym",
    parkName: "Olympic National Park",
    source: "nps",
    campingType: "developed_tent",
    description: "Rainforest tent camping at the Hoh Rain Forest trailhead.",
    amenities: { toilets: true, potableWater: true },
    reservationUrl: "https://www.nps.gov/olym/planyourvisit/camping.htm",
    permitRequired: false,
    fees: null,
    metadata: { seed: true },
  },
  {
    id: "seed-olympic-seven-lakes",
    externalId: "seed-olympic-seven-lakes",
    name: "Seven Lakes Basin Wilderness Camps",
    latitude: 47.906,
    longitude: -123.766,
    state: "WA",
    parkCode: "olym",
    parkName: "Olympic National Park",
    source: "nps",
    campingType: "backcountry",
    description: "High-country wilderness camps on the High Divide loop. Wilderness permit required.",
    amenities: {},
    reservationUrl: "https://www.nps.gov/olym/planyourvisit/wilderness-permits.htm",
    permitRequired: true,
    fees: null,
    metadata: { seed: true },
  },
  {
    id: "seed-acadia-blackwoods",
    externalId: "seed-acadia-blackwoods",
    name: "Blackwoods Campground",
    latitude: 44.31,
    longitude: -68.21,
    state: "ME",
    parkCode: "acad",
    parkName: "Acadia National Park",
    source: "nps",
    campingType: "developed_tent",
    description: "Wooded tent camping on Mount Desert Island near the Ocean Path.",
    amenities: { toilets: true, potableWater: true },
    reservationUrl: "https://www.recreation.gov/camping/campgrounds/232446",
    permitRequired: false,
    fees: null,
    metadata: { seed: true },
  },
  {
    id: "seed-ca-big-basin",
    externalId: "seed-ca-big-basin",
    name: "Big Basin Redwoods — Huckleberry Campground",
    latitude: 37.1726,
    longitude: -122.2217,
    state: "CA",
    parkCode: null,
    parkName: "Big Basin Redwoods State Park",
    source: "state",
    campingType: "developed_tent",
    description: "California state park tent camping among coast redwoods.",
    amenities: { toilets: true, potableWater: true },
    reservationUrl: "https://www.reservecalifornia.com/",
    permitRequired: false,
    fees: null,
    metadata: { seed: true },
  },
  {
    id: "seed-co-golden-gate",
    externalId: "seed-co-golden-gate",
    name: "Reverend's Ridge Campground",
    latitude: 39.8435,
    longitude: -105.425,
    state: "CO",
    parkCode: null,
    parkName: "Golden Gate Canyon State Park",
    source: "state",
    campingType: "developed_tent",
    description: "Colorado state park tent and RV camping west of Denver.",
    amenities: { toilets: true, potableWater: true },
    reservationUrl: "https://www.cpwshop.com/",
    permitRequired: false,
    fees: null,
    metadata: { seed: true },
  },
  {
    id: "seed-wa-deception-pass",
    externalId: "seed-wa-deception-pass",
    name: "Deception Pass — Cranberry Lake Campground",
    latitude: 48.399,
    longitude: -122.655,
    state: "WA",
    parkCode: null,
    parkName: "Deception Pass State Park",
    source: "state",
    campingType: "developed_tent",
    description: "Washington state park tent camping on Whidbey Island.",
    amenities: { toilets: true, potableWater: true },
    reservationUrl: "https://washington.goingtocamp.com/",
    permitRequired: false,
    fees: null,
    metadata: { seed: true },
  },
  {
    id: "seed-wa-enchantments",
    externalId: "seed-wa-enchantments",
    name: "The Enchantments Permit Zone",
    latitude: 47.488,
    longitude: -120.803,
    state: "WA",
    parkCode: null,
    parkName: "Alpine Lakes Wilderness",
    source: "ridb",
    campingType: "backcountry",
    description:
      "Overnight wilderness camping in the Enchantments. Recreation.gov permit lottery required in season.",
    amenities: {},
    reservationUrl: "https://www.recreation.gov/permits/233273",
    permitRequired: true,
    fees: null,
    metadata: { seed: true },
  },
];

export function filterSeedCampgrounds(filters: {
  q?: string;
  state?: string;
  campingType?: string;
  permitRequired?: string;
  source?: string;
}) {
  return SEED_CAMPGROUNDS.filter((camp) => {
    if (filters.q && !`${camp.name} ${camp.parkName}`.toLowerCase().includes(filters.q.toLowerCase())) {
      return false;
    }
    if (filters.state && filters.state !== "all" && camp.state !== filters.state) {
      return false;
    }
    if (
      filters.campingType &&
      filters.campingType !== "all" &&
      camp.campingType !== filters.campingType
    ) {
      return false;
    }
    if (filters.permitRequired === "yes" && !camp.permitRequired) return false;
    if (filters.permitRequired === "no" && camp.permitRequired) return false;
    if (filters.source && filters.source !== "all" && camp.source !== filters.source) {
      return false;
    }
    return true;
  });
}
