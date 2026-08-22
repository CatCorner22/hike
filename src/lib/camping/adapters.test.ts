import { describe, expect, it } from "vitest";
import { npsCampgroundToRecord, type NpsCampground } from "@/lib/nps/client";
import {
  ridbFacilityToRecord,
  ridbPermitToRecord,
  type RidbFacility,
  type RidbPermitEntrance,
} from "@/lib/ridb/client";
import { stateCampgroundToRecord } from "@/lib/state-parks";

describe("campground provider evidence adapters", () => {
  it("does not interpret a missing NPS permit field as no permit required", () => {
    const camp: NpsCampground = {
      id: "nps-1",
      name: "Example",
      parkCode: "exam",
      description: "Example campground",
      latitude: "37.5",
      longitude: "-119.5",
      reservationInfo: "",
      regulationsurl: "https://www.nps.gov/example/rules",
      fees: [],
      campsites: {},
      amenities: { TentOnly: 4 },
      url: "https://www.nps.gov/example/camp",
    };
    expect(npsCampgroundToRecord(camp, "CA")).toMatchObject({
      state: "CA",
      permitRequired: null,
      permitStatus: "unknown",
      accessStatus: "unknown",
    });
  });

  it("keeps RIDB facility permits unknown and does not invent a state for permit entrances", () => {
    const facility: RidbFacility = {
      FacilityID: "1",
      FacilityName: "Facility",
      FacilityDescription: "",
      FacilityLatitude: 38,
      FacilityLongitude: -110,
      FacilityTypeDescription: "Campground",
      Reservable: true,
      Enabled: true,
      LastUpdatedDate: "2026-08-01",
    };
    expect(ridbFacilityToRecord(facility, "UT")).toMatchObject({
      state: "UT",
      permitRequired: null,
      permitStatus: "unknown",
    });

    const entrance: RidbPermitEntrance = {
      PermitEntranceID: "2",
      PermitEntranceName: "Permit entrance",
      PermitEntranceDescription: "",
      PermitEntranceLatitude: 38,
      PermitEntranceLongitude: -110,
      District: "District",
      Zone: "Zone",
    };
    expect(ridbPermitToRecord(entrance)).toMatchObject({
      state: null,
      permitRequired: true,
      permitStatus: "required",
    });
  });

  it("does not infer a permit rule from a state-feed backcountry label", () => {
    expect(stateCampgroundToRecord({
      externalId: "state-1",
      name: "Primitive site",
      latitude: 39,
      longitude: -105,
      state: "CO",
      campingType: "backcountry",
    })).toMatchObject({ permitRequired: null, permitStatus: "unknown" });
  });
});
