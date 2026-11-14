import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ModelData } from "@/lib/types";

const pct = (v?: number) => (v === undefined ? "–" : `${Math.round(v * 100)}%`);

/** All four Suppression models side by side for each habitat atmosphere (values from model.json). */
export function HabitatOutlook({ m }: { m: ModelData }) {
  const rows = Object.entries(m.habitats);
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Habitat air</TableHead>
              <TableHead className="text-right">Burning rate K (mm²/s)</TableHead>
              <TableHead className="text-right">Flame goes out at (mm)</TableHead>
              <TableHead className="text-right">Goes out cleanly</TableHead>
              <TableHead className="text-right">Cool flame lingers</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([name, h]) => (
              <TableRow key={name}>
                <TableCell>
                  <div className="font-medium">{name}</div>
                  <div className="text-xs text-muted-foreground">
                    {h.o2_pct}% O₂ · {h.pressure_kpa.toFixed(0)} kPa
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {h.burning_rate.mean.toFixed(2)} <span className="text-muted-foreground">± {(1.96 * h.burning_rate.sd).toFixed(2)}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {h.extinction_d.mean.toFixed(2)} <span className="text-muted-foreground">± {(1.96 * h.extinction_d.sd).toFixed(2)}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {pct(h.p_clean_extinction)}
                  {!h.inside_training_range && (
                    <Badge variant="outline" className="ml-2 font-normal">extrapolation</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {pct(h.p_cool_flame)}
                  {h.cool_flame_inside_range === false && (
                    <Badge variant="outline" className="ml-2 font-normal">outside CFI range</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        First three columns: a 2 mm methanol droplet in nitrogen (FLEX conditions). Cool flame: a 4 mm n-dodecane droplet (CFI conditions). ± = 95 % range.
        Near Moon-base air, 15 of the 17 real FLEX tests ended with the droplet breaking apart rather than going out cleanly. The models pick that up,
        and it matters: a bursting droplet scatters burning fuel. &ldquo;Extrapolation&rdquo; marks atmospheres outside what was tested; treat those as a guess.
      </p>
    </div>
  );
}
