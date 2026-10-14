import { describe, expect, it } from "vitest";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider.js";
import { AppImageUpdater, DebUpdater, PacmanUpdater, RpmUpdater } from "electron-updater";

import { DEFAULT_ZCODE_ENDPOINT_ORIGIN, type ElectronReleaseChannel } from "@zcode/shared";
import {
  ManifestUpdateProvider,
  buildElectronManifestUrl,
  getElectronReleasePlatform,
  resolveManifestFiles,
} from "./manifestUpdateProvider.js";
import type { UpdateFileInfo, UpdateInfo } from "builder-util-runtime";

/*
 * P8-RELEASE-DRIFT-1 — T-5 (audit §4.2): the ManifestUpdateProvider battery
 * — manifest URL construction (platform/channel/device_mid), missing-checksum
 * rejection, tampered-checksum rejection (format guard added with this order),
 * cross-format Linux rejection, channel staleness propagation — plus T-4:
 * the packaged updater's manifest requests never target the
 * `http://localhost:8081` placeholder feed (freeze §6.1 "provably inert").
 */

/** 86 base64 chars + "==" padding — a structurally valid sha512. */
const VALID_SHA512_BASE64 = `${"A".repeat(86)}==`;
const VALID_SHA512_HEX = "a".repeat(128);
const VALID_SHA2_HEX = "b".repeat(64);

/** `sha2` rides alongside the declared shape (the provider reads it via an `in` guard). */
type ManifestFileFixture = UpdateFileInfo & { sha2?: string };

function manifestInfo(files: ManifestFileFixture[], version = "3.15.0"): UpdateInfo {
  return { version, files } as UpdateInfo;
}

describe("manifest URL construction", () => {
  it("builds the manifest API URL with platform, channel, and device_mid", () => {
    const url = buildElectronManifestUrl({
      endpointOrigin: DEFAULT_ZCODE_ENDPOINT_ORIGIN,
      platform: "linux-x86_64",
      deviceMid: "device-42",
      channel: "preview",
    });
    expect(url.origin).toBe("https://zcode.z.ai");
    expect(url.pathname).toBe("/api/v1/releases/electron/manifest");
    expect(url.searchParams.get("platform")).toBe("linux-x86_64");
    expect(url.searchParams.get("device_mid")).toBe("device-42");
    expect(url.searchParams.get("channel")).toBe("3"); // preview → 3
  });

  it("maps the stable channel to 1 and omits an empty device_mid", () => {
    const url = buildElectronManifestUrl({
      endpointOrigin: "https://zcode.z.ai",
      platform: "windows-x86_64",
      channel: "stable",
    });
    expect(url.searchParams.get("channel")).toBe("1");
    expect(url.searchParams.has("device_mid")).toBe(false);
  });

  it("honors an explicit manifestUrl base and appends the query params", () => {
    const url = buildElectronManifestUrl({
      endpointOrigin: "https://ignored.example",
      manifestUrl: "https://mirror.example/manifest",
      platform: "darwin-arm64",
      channel: "stable",
    });
    expect(url.origin).toBe("https://mirror.example");
    expect(url.pathname).toBe("/manifest");
    expect(url.searchParams.get("platform")).toBe("darwin-arm64");
    expect(url.searchParams.get("channel")).toBe("1");
  });

  it("getElectronReleasePlatform maps node platform/arch to the release vocabulary", () => {
    expect(getElectronReleasePlatform("win32", "x64")).toBe("windows-x86_64");
    expect(getElectronReleasePlatform("darwin", "arm64")).toBe("darwin-aarch64");
    expect(getElectronReleasePlatform("linux", "x64")).toBe("linux-x86_64");
  });
});

describe("T-4 — the localhost:8081 placeholder feed is never targeted", () => {
  it("no default-origin manifest URL ever points at the placeholder", () => {
    for (const channel of ["stable", "preview"] as const) {
      for (const platform of ["linux-x86_64", "windows-x86_64", "darwin-aarch64"]) {
        const url = buildElectronManifestUrl({
          endpointOrigin: DEFAULT_ZCODE_ENDPOINT_ORIGIN,
          platform,
          channel,
        });
        expect(url.toString()).not.toContain("localhost:8081");
        expect(url.origin).toBe("https://zcode.z.ai");
      }
    }
  });

  it("the provider's live manifest request goes to the resolved origin, not the placeholder", async () => {
    const { provider, requested } = await createProviderWithCapturedRequest({
      resolveEndpointOrigin: () => "https://zcode.z.ai",
    });
    const info = await provider.getLatestVersion();
    expect(info.version).toBe("3.15.0");
    expect(requested.url?.origin).toBe("https://zcode.z.ai");
    expect(requested.url?.toString()).not.toContain("localhost:8081");
  });
});

describe("resolveManifestFiles — checksum enforcement", () => {
  const baseUrl = new URL("https://zcode.z.ai/");

  it("rejects a manifest file with NO checksum before any download", () => {
    const files = [{ url: "releases/app-3.15.0.deb" } as ManifestFileFixture];
    expect(() => resolveManifestFiles(manifestInfo(files), baseUrl, [".deb"])).toThrow(
      /missing checksum/,
    );
  });

  it("rejects a TAMPERED (malformed) sha512 before any download (P8 format guard)", () => {
    const files = [{ url: "releases/app-3.15.0.deb", sha512: "deadbeef" } as ManifestFileFixture];
    expect(() => resolveManifestFiles(manifestInfo(files), baseUrl, [".deb"])).toThrow(
      /invalid \(tampered\?\) sha512/,
    );
  });

  it("rejects a tampered sha2 as well", () => {
    const files = [{ url: "releases/app-3.15.0.deb", sha2: "zzz" } as ManifestFileFixture];
    expect(() => resolveManifestFiles(manifestInfo(files), baseUrl, [".deb"])).toThrow(
      /invalid \(tampered\?\) sha2/,
    );
  });

  it("accepts a structurally valid base64 sha512 and carries it into the resolved file", () => {
    const files = [
      { url: "releases/app-3.15.0.deb", sha512: VALID_SHA512_BASE64 } as ManifestFileFixture,
    ];
    const resolved = resolveManifestFiles(manifestInfo(files), baseUrl, [".deb"]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.url.toString()).toBe("https://zcode.z.ai/releases/app-3.15.0.deb");
    expect(resolved[0]!.info.sha512).toBe(VALID_SHA512_BASE64);
  });

  it("accepts a valid hex sha512 and a valid hex sha2", () => {
    const hex = resolveManifestFiles(
      manifestInfo([{ url: "releases/app.deb", sha512: VALID_SHA512_HEX } as ManifestFileFixture]),
      baseUrl,
      [".deb"],
    );
    expect(hex[0]!.info.sha512).toBe(VALID_SHA512_HEX);
    const sha2 = resolveManifestFiles(
      manifestInfo([{ url: "releases/app.deb", sha2: VALID_SHA2_HEX } as ManifestFileFixture]),
      baseUrl,
      [".deb"],
    );
    expect((sha2[0]!.info as ManifestFileFixture).sha2).toBe(VALID_SHA2_HEX);
  });
});

describe("resolveManifestFiles — cross-format Linux rejection", () => {
  const baseUrl = new URL("https://zcode.z.ai/");

  it("rejects a deb-format runtime offered only rpm artifacts", () => {
    const debRuntime = Object.create(DebUpdater.prototype) as DebUpdater;
    const extensions = linuxExtensionsOf(debRuntime);
    expect(extensions).toEqual([".deb"]);
    const files = [{ url: "releases/app-3.15.0.rpm", sha512: VALID_SHA512_BASE64 }];
    expect(() => resolveManifestFiles(manifestInfo(files), baseUrl, extensions)).toThrow(
      /Manifest contains no update file for \.deb/,
    );
  });

  it("rejects an AppImage runtime offered only deb artifacts", () => {
    const appImageRuntime = Object.create(AppImageUpdater.prototype) as AppImageUpdater;
    const files = [{ url: "releases/app-3.15.0.deb", sha512: VALID_SHA512_BASE64 }];
    expect(() =>
      resolveManifestFiles(manifestInfo(files), baseUrl, linuxExtensionsOf(appImageRuntime)),
    ).toThrow(/Manifest contains no update file for \.appimage/);
  });
  it("rpm and pacman runtimes keep their own extension sets", () => {
    const rpm = Object.create(RpmUpdater.prototype) as RpmUpdater;
    const pacman = Object.create(PacmanUpdater.prototype) as PacmanUpdater;
    expect(linuxExtensionsOf(rpm)).toEqual([".rpm"]);
    expect(linuxExtensionsOf(pacman)).toEqual([".pkg.tar.zst", ".pacman"]);
  });

  it("pacman .pkg.tar.zst entries carry only the basename as the cache name", () => {
    const pacman = Object.create(PacmanUpdater.prototype) as PacmanUpdater;
    const files = [
      { url: "releases/app-3.15.0.pkg.tar.zst", sha512: VALID_SHA512_BASE64 },
    ] as ManifestFileFixture[];
    const resolved = resolveManifestFiles(manifestInfo(files), baseUrl, linuxExtensionsOf(pacman));
    expect(resolved[0]!.info.url).toBe("app-3.15.0.pkg.tar.zst");
    expect(resolved[0]!.url.toString()).toBe("https://zcode.z.ai/releases/app-3.15.0.pkg.tar.zst");
  });

  function linuxExtensionsOf(updater: unknown): readonly string[] | null {
    // Mirrors getLinuxUpdateExtensions via the provider constructor path.
    const provider = new ManifestUpdateProvider(
      { provider: "custom" },
      updater as never,
      fakeRuntimeOptions(),
    );
    return (provider as unknown as { linuxExtensions: readonly string[] | null }).linuxExtensions;
  }
});

describe("ManifestUpdateProvider.getLatestVersion — request + channel staleness", () => {
  it("sends platform/channel/device_mid as query params AND headers", async () => {
    const { provider, requested } = await createProviderWithCapturedRequest({
      deviceMid: "device-42",
      resolveReleaseChannel: () => "preview",
    });
    const info = await provider.getLatestVersion();
    expect(info.version).toBe("3.15.0");
    expect(requested.url?.searchParams.get("platform")).toBe("linux-x86_64");
    expect(requested.url?.searchParams.get("device_mid")).toBe("device-42");
    expect(requested.url?.searchParams.get("channel")).toBe("3");
    expect(requested.headers?.["X-Platform"]).toBe("linux-x86_64");
    expect(requested.headers?.["X-Release-Channel"]).toBe("3");
    expect(requested.headers?.["X-Device-Mid"]).toBe("device-42");
    expect(requested.headers?.["accept"]).toContain("yaml");
  });

  it("propagates THIS request's channel on the UpdateInfo (stale-response detection)", async () => {
    const channels: ElectronReleaseChannel[] = ["stable", "preview"];
    let call = 0;
    const { provider } = await createProviderWithCapturedRequest({
      resolveReleaseChannel: () => channels[Math.min(call++, channels.length - 1)]!,
    });
    const first = await provider.getLatestVersion();
    const second = await provider.getLatestVersion();
    expect(readChannelOf(first)).toBe("stable");
    expect(readChannelOf(second)).toBe("preview");
  });

  it("rejects an unparseable manifest body", async () => {
    const { provider } = await createProviderWithCapturedRequest({
      body: "- just\n- a\n- list\n",
    });
    await expect(provider.getLatestVersion()).rejects.toThrow(/Invalid electron update manifest/);
  });

  it("rejects an empty manifest body", async () => {
    const { provider } = await createProviderWithCapturedRequest({ body: "" });
    await expect(provider.getLatestVersion()).rejects.toThrow(/Empty electron update manifest/);
  });
});

function fakeRuntimeOptions(): ProviderRuntimeOptions {
  return {
    isUseMultipleRangeRequest: false,
    platform: "linux",
    executor: {} as ProviderRuntimeOptions["executor"],
  };
}

/** The provider attaches the request channel beyond the declared UpdateInfo shape. */
function readChannelOf(info: UpdateInfo): string | undefined {
  return (info as UpdateInfo & { zcodeReleaseChannel?: string }).zcodeReleaseChannel;
}

const MANIFEST_BODY = [
  "version: 3.15.0",
  "files:",
  "  - url: releases/app-3.15.0.deb",
  `    sha512: ${VALID_SHA512_BASE64}`,
].join("\n");

async function createProviderWithCapturedRequest(options: {
  deviceMid?: string;
  resolveReleaseChannel?: () => ElectronReleaseChannel | Promise<ElectronReleaseChannel>;
  resolveEndpointOrigin?: () => string | Promise<string>;
  body?: string;
}) {
  const requested: { url?: URL; headers?: Record<string, string> } = {};
  const provider = new ManifestUpdateProvider(
    {
      provider: "custom",
      endpointOrigin: DEFAULT_ZCODE_ENDPOINT_ORIGIN,
      releasePlatform: "linux-x86_64",
      ...(options.deviceMid ? { deviceMid: options.deviceMid } : {}),
      ...(options.resolveReleaseChannel
        ? { resolveReleaseChannel: options.resolveReleaseChannel }
        : {}),
      ...(options.resolveEndpointOrigin
        ? { resolveEndpointOrigin: options.resolveEndpointOrigin }
        : {}),
    },
    Object.create(DebUpdater.prototype) as never,
    fakeRuntimeOptions(),
  );
  (
    provider as unknown as {
      httpRequest: (url: URL, headers?: Record<string, string>) => Promise<string | null>;
    }
  ).httpRequest = async (url, headers) => {
    requested.url = url;
    requested.headers = headers as Record<string, string>;
    return options.body ?? MANIFEST_BODY;
  };
  return { provider, requested };
}
