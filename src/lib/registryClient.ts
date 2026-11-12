import type { Env } from "../types";
import { hubUrl } from "./urls";

/** Canonical record the hub's shared registry returns for any org or workspace id, canonical or legacy. */
export interface RegistryResolution {
  type: "organization" | "workspace";
  id: string;
  [key: string]: unknown;
}

export class RegistryUnavailableError extends Error {}

/**
 * Server-to-server client for the hub's shared org/workspace registry (`/api/registry/*`). This backend already trusts the
 * caller's Kinde token, so it asks the hub on that user's behalf with the hub admin secret plus the user's id and email.
 * The registry is the single owner of orgs and workspaces; this app keeps only its own content keyed by the ids it returns.
 */
export class RegistryClient {
  constructor(
    private readonly env: Pick<Env, "HUB_URL" | "HUB_ADMIN_SECRET">,
    private readonly user: { userId: string; email?: string },
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /** True when this deployment has the secret needed to reach the registry. */
  get configured(): boolean {
    return Boolean(this.env.HUB_ADMIN_SECRET);
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.env.HUB_ADMIN_SECRET) throw new RegistryUnavailableError("HUB_ADMIN_SECRET is not set");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.env.HUB_ADMIN_SECRET}`);
    headers.set("X-Kecker-User-Id", this.user.userId);
    if (this.user.email) headers.set("X-Kecker-User-Email", this.user.email);
    if (init.body) headers.set("Content-Type", "application/json");
    return this.fetcher(`${hubUrl(this.env)}/api/registry${path}`, { ...init, headers });
  }

  /** Maps a legacy per-app org or workspace id to the hub's canonical record, or null when the hub does not know it. */
  async resolve(idOrAlias: string): Promise<RegistryResolution | null> {
    const res = await this.call(`/resolve/${encodeURIComponent(idOrAlias)}?appId=scribe`);
    if (res.status === 404) return null;
    if (!res.ok) throw new RegistryUnavailableError(`registry resolve failed (${res.status})`);
    return (await res.json()) as RegistryResolution;
  }

  /** The organizations this user belongs to, personal one included. */
  async organizations(): Promise<unknown[]> {
    const res = await this.call("/organizations");
    if (!res.ok) throw new RegistryUnavailableError(`registry organizations failed (${res.status})`);
    return ((await res.json()) as { organizations: unknown[] }).organizations;
  }

  /** The workspaces this user can open across all orgs. */
  async workspaces(): Promise<unknown[]> {
    const res = await this.call("/workspaces");
    if (!res.ok) throw new RegistryUnavailableError(`registry workspaces failed (${res.status})`);
    return ((await res.json()) as { workspaces: unknown[] }).workspaces;
  }
}
