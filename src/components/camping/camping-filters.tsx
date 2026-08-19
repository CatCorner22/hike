"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CAMPING_TYPE_LABELS } from "@/lib/constants";

export interface CampingFiltersState {
  state: string;
  campingType: string;
  permitRequired: string;
  source: string;
}

interface CampingFiltersProps {
  filters: CampingFiltersState;
  onChange: (filters: CampingFiltersState) => void;
  states: string[];
}

export function CampingFilters({ filters, onChange, states }: CampingFiltersProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <Label className="text-xs">State</Label>
        <Select
          value={filters.state}
          onValueChange={(v) => onChange({ ...filters, state: v ?? "all" })}
        >
          <SelectTrigger>
            <SelectValue placeholder="All states" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {states.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Camping type</Label>
        <Select
          value={filters.campingType}
          onValueChange={(v) => onChange({ ...filters, campingType: v ?? "all" })}
        >
          <SelectTrigger>
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(CAMPING_TYPE_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Permit required</Label>
        <Select
          value={filters.permitRequired}
          onValueChange={(v) => onChange({ ...filters, permitRequired: v ?? "all" })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any</SelectItem>
            <SelectItem value="yes">Permit required</SelectItem>
            <SelectItem value="no">No permit</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Source</Label>
        <Select
          value={filters.source}
          onValueChange={(v) => onChange({ ...filters, source: v ?? "all" })}
        >
          <SelectTrigger>
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="nps">National Parks (NPS)</SelectItem>
            <SelectItem value="ridb">Federal (RIDB)</SelectItem>
            <SelectItem value="state">State parks</SelectItem>
            <SelectItem value="osm">OpenStreetMap</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
