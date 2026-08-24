import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const BrandingSchema = z.object({
  platform_name: z.string().default("ARC"), logo_url: z.string().url().nullish(), logo_only: z.boolean().default(false),
  primary_colour: z.string().nullish(), accent_colour: z.string().nullish(), background_colour: z.string().nullish(),
  text_colour: z.string().nullish(), muted_colour: z.string().nullish(), sidebar_background_colour: z.string().nullish(),
  sidebar_text_colour: z.string().nullish(), sidebar_hover_background_colour: z.string().nullish(),
  sidebar_selected_background_colour: z.string().nullish(), border_colour: z.string().nullish(),
  input_height_px: z.number().nullish(), corner_radius_px: z.number().nullish(), scrollbar_width_px: z.number().nullish(),
  font_family: z.string().nullish(), base_font_size_px: z.number().nullish(), support_email: z.string().nullish(), support_url: z.string().nullish(),
}).passthrough();
export type Branding = z.infer<typeof BrandingSchema>;

export class BrandingService {
  constructor(private readonly cachePath: string) {}

  async loadCached(): Promise<Branding> {
    try { return BrandingSchema.parse(JSON.parse(await readFile(this.cachePath, "utf8"))); }
    catch { return BrandingSchema.parse({}); }
  }

  async load(serverUrl: string): Promise<Branding> {
    try {
      const response = await fetch(`${serverUrl.replace(/\/$/, "")}/api/v1/branding/public`, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`Branding returned ${response.status}`);
      const branding = BrandingSchema.parse(await response.json());
      await this.cache(branding);
      return branding;
    } catch { return this.loadCached(); }
  }

  private async cache(branding: Branding): Promise<void> {
    await mkdir(path.dirname(this.cachePath), { recursive: true });
    const temp = `${this.cachePath}.tmp`;
    await writeFile(temp, JSON.stringify(branding));
    await rename(temp, this.cachePath);
  }
}
