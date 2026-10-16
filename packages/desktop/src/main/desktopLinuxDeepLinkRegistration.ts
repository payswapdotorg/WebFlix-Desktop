import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ZCODE_PRODUCT_FLAVOR } from "@zcode/shared";
import { installLinuxAppImageDesktopIconBestEffort } from "./desktopLinuxAppImageIcon.js";
import {
  runXdgCommand,
  XDG_COMMAND_TIMEOUT_MS,
  type LinuxDesktopCommandRunner,
  type LinuxDeepLinkRegistrationLogger,
} from "./desktopLinuxXdg.js";
import {
  desktopProductIdentities,
  isWebFlixIdentityRequested,
  type DesktopProductFlavor,
} from "../../scripts/desktop-product-identity.mjs";

/*
 * P9-FIX-1 F1（QA 证据 desktop-entry:<flavor>:user-level）：用户级 deep-link desktop
 * entry 的文件名与身份字段跟随产品身份（同一事实源 desktop-product-identity.mjs，
 * 打包构建从它冻结 webflix.desktop / Icon=webflix / x-scheme-handler/webflix）。
 * ZCode production/preview 保持历史 zcode.desktop 行为逐字节不变。
 */

/** 用户级 desktop entry 的身份档案：文件名/图标/MIME/归属标记随产品身份切换。 */
interface LinuxDeepLinkDesktopEntryProfile {
  readonly desktopFileName: string;
  readonly iconName: string;
  /** xdg-mime 注册的 scheme handler MIME（模板里统一补尾部分号 `;`）。 */
  readonly schemeHandlerMimeType: string;
  /** 归属标记行：识别用户级条目是否由本应用写入（历史版本都带这行 Comment）。 */
  readonly ownershipMarkerLine: string;
  /** 调用方未传 productName 时的回落名（对齐打包身份的 productName）。 */
  readonly fallbackProductName: string;
}

/*
 * ZCode（production/preview）档案：与历史行为逐字节一致（P9-FIX-1 要求 regression-free）。
 * 注意 preview 也保持 zcode.desktop——运行时注册从未跟随 linuxExecutableName 的
 * zcode-preview 拼写，本次修复不改这个现状。
 */
const ZCODE_LINUX_DEEP_LINK_PROFILE: LinuxDeepLinkDesktopEntryProfile = {
  desktopFileName: "zcode.desktop",
  iconName: "zcode",
  schemeHandlerMimeType: "x-scheme-handler/zcode",
  ownershipMarkerLine: "Comment=ZCode Desktop App",
  fallbackProductName: "ZCode",
};

/** WebFlix 档案：每个字段都从身份模块推导（desktop-product-identity.mjs，单一事实源）。 */
function resolveWebFlixLinuxDeepLinkProfile(): LinuxDeepLinkDesktopEntryProfile {
  const identity = desktopProductIdentities.webflix;
  return {
    desktopFileName: `${identity.linuxExecutableName}.desktop`,
    iconName: identity.linuxExecutableName,
    schemeHandlerMimeType: `x-scheme-handler/${identity.scheme}`,
    ownershipMarkerLine: `Comment=${identity.desktopEntryDescription}`,
    fallbackProductName: identity.productName,
  };
}

/**
 * 解析当前运行时的用户级 desktop entry 身份档案（P9-FIX-1 F1）。
 * 判别器与桌面运行时其余身份面同源：烤入 flavor（ZCODE_PRODUCT_FLAVOR）+ 打包态
 * （本注册只在 app.isPackaged 的 Linux 路径触发），显式 WEBFLIX_IDENTITY 覆盖优先
 * ——即 packaged WebFlix 引导链导出的运行时身份契约（WEBFLIX_IDENTITY=1）。
 * ZCode 身份（含显式 WEBFLIX_IDENTITY=0 强制关闭）一律回落 ZCode 档案。
 */
export function resolveLinuxDeepLinkDesktopEntryProfile(
  params: {
    env?: NodeJS.ProcessEnv;
    flavor?: DesktopProductFlavor;
    isPackaged?: boolean;
  } = {},
): LinuxDeepLinkDesktopEntryProfile {
  const webFlixIdentityActive = isWebFlixIdentityRequested(params.env ?? process.env, {
    flavor: params.flavor ?? ZCODE_PRODUCT_FLAVOR,
    isPackaged: params.isPackaged ?? true,
  });
  return webFlixIdentityActive
    ? resolveWebFlixLinuxDeepLinkProfile()
    : ZCODE_LINUX_DEEP_LINK_PROFILE;
}

type LinuxDesktopEnv = {
  APPIMAGE?: string;
  XDG_DATA_HOME?: string;
  XDG_DATA_DIRS?: string;
  /** 运行时身份契约（packaged WebFlix 引导链导出；显式覆盖优先）。 */
  WEBFLIX_IDENTITY?: string;
};

interface RegisterLinuxDeepLinkProtocolOptions {
  executablePath: string;
  homeDir: string;
  productName?: string;
  iconSourcePath?: string;
  env?: LinuxDesktopEnv;
  argv?: string[];
  logger: LinuxDeepLinkRegistrationLogger;
  runCommand?: LinuxDesktopCommandRunner;
  systemApplicationDirs?: string[];
  /**
   * P9-FIX-1 F1：运行时产品身份输入（desktop entry 档案选择器）。默认跟随烤入
   * flavor（ZCODE_PRODUCT_FLAVOR）+ 打包态——唯一真实调用方（desktopOAuthDeepLink）
   * 只在 app.isPackaged 时进入本注册；测试显式注入各 flavor。
   */
  productIdentity?: {
    flavor?: DesktopProductFlavor;
    isPackaged?: boolean;
  };
}

interface LinuxDeepLinkCommand {
  executablePath: string;
  args: string[];
}

const APPIMAGE_DEEP_LINK_ARG_NAMES = new Set([
  "--no-sandbox",
  "--disable-gpu",
  "--disable-software-rasterizer",
]);

const APPIMAGE_DEEP_LINK_ARG_PREFIXES = [
  "--use-gl=",
  "--use-angle=",
  "--disable-features=",
  "--enable-features=",
];

function resolveLinuxDeepLinkCommand(params: {
  env?: { APPIMAGE?: string };
  executablePath: string;
  argv?: string[];
}): LinuxDeepLinkCommand {
  const appImagePath = params.env?.APPIMAGE?.trim();
  if (!appImagePath) {
    return { executablePath: params.executablePath, args: [] };
  }

  return {
    executablePath: appImagePath,
    // AppImage 的 deep-link 回调会由 xdg-open 按 .desktop Exec 二次启动。
    // 用户手动启动时附加的 sandbox/GPU 参数不会自动继承，二次启动可能在 Electron 初始化前崩溃。
    // 这里只持久化影响启动成败的 allowlist 参数，避免把 deep link URL、调试端口或工作区路径写死。
    args: resolveAppImageDeepLinkArgs(params.argv ?? []),
  };
}

function quoteDesktopExecPath(value: string): string {
  return `"${value.replace(/[\\"`$]/g, (match) => `\\${match}`)}"`;
}

function isAllowedAppImageDeepLinkArg(arg: string): boolean {
  return (
    APPIMAGE_DEEP_LINK_ARG_NAMES.has(arg) ||
    APPIMAGE_DEEP_LINK_ARG_PREFIXES.some((prefix) => arg.startsWith(prefix))
  );
}

function resolveAppImageDeepLinkArgs(argv: string[]): string[] {
  const args: string[] = [];
  const seen = new Set<string>();
  for (const arg of argv) {
    if (!isAllowedAppImageDeepLinkArg(arg) || seen.has(arg)) {
      continue;
    }
    seen.add(arg);
    args.push(arg);
  }
  return args;
}

function quoteDesktopExecToken(value: string): string {
  return quoteDesktopExecPath(value);
}

function formatDesktopExec(command: LinuxDeepLinkCommand): string {
  return [command.executablePath, ...command.args]
    .map(quoteDesktopExecToken)
    .concat("%U")
    .join(" ");
}

function createLinuxDeepLinkDesktopEntry(params: {
  executablePath: string;
  args?: string[];
  productName?: string;
  iconName?: string;
  profile: LinuxDeepLinkDesktopEntryProfile;
}): string {
  const productName = params.productName ?? params.profile.fallbackProductName;
  const iconName = params.iconName ?? params.profile.iconName;
  const command = {
    executablePath: params.executablePath,
    args: params.args ?? [],
  };
  return [
    "[Desktop Entry]",
    `Name=${productName}`,
    params.profile.ownershipMarkerLine,
    `Exec=${formatDesktopExec(command)}`,
    "Terminal=false",
    "Type=Application",
    `Icon=${iconName}`,
    "Categories=Development;",
    `MimeType=${params.profile.schemeHandlerMimeType};`,
    `StartupWMClass=${productName}`,
    "",
  ].join("\n");
}

function resolveLinuxUserDataDir(params: {
  env?: { XDG_DATA_HOME?: string };
  homeDir: string;
}): string {
  const xdgDataHome = params.env?.XDG_DATA_HOME?.trim();
  return xdgDataHome || join(params.homeDir, ".local", "share");
}

function resolveLinuxSystemApplicationDirs(env?: { XDG_DATA_DIRS?: string }): string[] {
  const raw = env?.XDG_DATA_DIRS?.trim();
  const entries = raw
    ? raw
        .split(":")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
  // XDG 规范默认值为 /usr/local/share:/usr/share；全部为空的 XDG_DATA_DIRS 也回落默认值。
  const dataDirs = entries.length > 0 ? entries : ["/usr/local/share", "/usr/share"];
  return dataDirs.map((dir) => join(dir, "applications"));
}

function findSystemLevelDesktopEntryPath(
  systemApplicationDirs: string[],
  profile: LinuxDeepLinkDesktopEntryProfile,
): string | undefined {
  for (const dir of systemApplicationDirs) {
    const candidate = join(dir, profile.desktopFileName);
    // 边界：目录或损坏的路径不应被当成有效系统级条目，否则纯 AppImage 用户
    // 的用户级注册会被病态路径误抑制。只有普通文件才参与遮蔽判断。
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // 路径不存在或不可 stat（权限），跳过该候选目录。
    }
  }
  return undefined;
}

function isOwnedDesktopEntry(path: string, profile: LinuxDeepLinkDesktopEntryProfile): boolean {
  try {
    const content = readFileSync(path, "utf8");
    // 去掉 \r 与行首尾空白，兼容 CRLF 行尾或手工编辑器引入的额外空白，
    // 避免可清理的遗留条目被误判为用户自定义条目而永久残留。
    return content
      .split("\n")
      .some((line) => line.replaceAll("\r", "").trim() === profile.ownershipMarkerLine);
  } catch {
    return false;
  }
}

function removeOwnedUserDesktopEntry(
  desktopFilePath: string,
  logger: LinuxDeepLinkRegistrationLogger,
  profile: LinuxDeepLinkDesktopEntryProfile,
): void {
  if (!existsSync(desktopFilePath)) {
    return;
  }
  if (!isOwnedDesktopEntry(desktopFilePath, profile)) {
    logger.warn("[deep-link] Linux 用户级 desktop entry 非本应用写入，保留不清理", {
      desktopFilePath,
      desktopFileName: profile.desktopFileName,
    });
    return;
  }
  try {
    rmSync(desktopFilePath);
    logger.info("[deep-link] 已清理遗留的用户级 desktop entry，恢复系统级条目", {
      desktopFilePath,
      desktopFileName: profile.desktopFileName,
    });
  } catch (error) {
    logger.warn("[deep-link] 清理遗留的用户级 desktop entry 失败", {
      desktopFilePath,
      desktopFileName: profile.desktopFileName,
      error,
    });
  }
}

function resolveLinuxDeepLinkDesktopFilePath(
  dataDir: string,
  profile: LinuxDeepLinkDesktopEntryProfile,
): string {
  return join(dataDir, "applications", profile.desktopFileName);
}

function writeFileIfChanged(path: string, content: string): boolean {
  if (existsSync(path) && readFileSync(path, "utf8") === content) {
    return false;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return true;
}

export function registerLinuxDeepLinkProtocol(options: RegisterLinuxDeepLinkProtocolOptions): void {
  // P9-FIX-1 F1：档案随产品身份解析一次，后续文件名/字段/清理/注册全部走同一档案。
  const profile = resolveLinuxDeepLinkDesktopEntryProfile({
    env: options.env,
    flavor: options.productIdentity?.flavor,
    isPackaged: options.productIdentity?.isPackaged,
  });
  const command = resolveLinuxDeepLinkCommand({
    env: options.env,
    executablePath: options.executablePath,
    argv: options.argv,
  });
  const dataDir = resolveLinuxUserDataDir({ env: options.env, homeDir: options.homeDir });
  const desktopFilePath = resolveLinuxDeepLinkDesktopFilePath(dataDir, profile);
  const applicationsDir = dirname(desktopFilePath);
  const desktopEntry = createLinuxDeepLinkDesktopEntry({
    ...command,
    productName: options.productName,
    profile,
  });
  let protocolRegistered = false;
  const runCommand = options.runCommand ?? runXdgCommand;

  // 用户级 desktop entry（zcode.desktop / webflix.desktop，随产品身份）在 XDG
  // 解析中永远优先于系统级同名条目。rpm/deb 安装后，旧 AppImage 写入的用户级条目会把
  // /usr/share/applications/ 下的同名系统级条目持续遮蔽，快捷方式和 deep link 一直
  // 指向旧 AppImage（文件还在时）或直接失效（文件被删后），只有手动跑一次新版才会被覆盖。
  // 现在只要检测到系统级同 ID 条目：
  // - 系统安装形态（rpm/deb）运行时：清掉本应用写入的遗留用户级条目，且不再写用户级；
  // - AppImage 运行时：不再写用户级条目和用户级图标，避免旧 AppImage 再度遮蔽系统安装。
  // 用户手写的自定义条目（无归属标记）不受影响，保留不清理；清理只针对本 flavor 自己的
  // 文件名（WebFlix 绝不清理 zcode.desktop——那是 ZCode flavor 的文件，即使它是旧版
  // WebFlix 缺陷构建留下的，其归属标记与真实 ZCode 条目无法区分，删除即可能误伤）。
  const systemDesktopEntryPath = findSystemLevelDesktopEntryPath(
    options.systemApplicationDirs ?? resolveLinuxSystemApplicationDirs(options.env),
    profile,
  );

  try {
    let changed = false;
    if (systemDesktopEntryPath) {
      options.logger.info("[deep-link] Linux 系统级 desktop entry 已存在", {
        systemDesktopEntryPath,
        desktopFilePath,
      });
      removeOwnedUserDesktopEntry(desktopFilePath, options.logger, profile);
    } else {
      changed = writeFileIfChanged(desktopFilePath, desktopEntry);
    }
    // AppImage 直跑不会像 deb 安装包一样稳定写入系统 desktop entry。
    // deep link 是 OAuth/支付/工作区打开的核心链路，必须先完成用户级协议处理器刷新；
    // 图标安装是可选增强，放到核心注册成功后独立降级，避免扩大登录回调失败域。
    const updateResult = runCommand("update-desktop-database", [applicationsDir]);
    const defaultResult = runCommand("xdg-mime", [
      "default",
      profile.desktopFileName,
      profile.schemeHandlerMimeType,
    ]);

    if (defaultResult.status === 0) {
      protocolRegistered = true;
      options.logger.info("[deep-link] Linux 用户级协议注册成功", {
        desktopFilePath,
        desktopFileName: profile.desktopFileName,
        executablePath: command.executablePath,
        args: command.args,
        changed,
        systemDesktopEntryPath,
      });
    } else {
      options.logger.warn("[deep-link] Linux 用户级协议注册失败", {
        desktopFilePath,
        desktopFileName: profile.desktopFileName,
        executablePath: command.executablePath,
        args: command.args,
        status: defaultResult.status,
        signal: defaultResult.signal,
        timeoutMs: defaultResult.signal === "SIGTERM" ? XDG_COMMAND_TIMEOUT_MS : undefined,
        error: defaultResult.error?.message,
        stderr: defaultResult.stderr?.trim(),
      });
    }

    if (updateResult.error) {
      options.logger.warn("[deep-link] update-desktop-database 不可用，已跳过", {
        desktopFilePath,
        message: updateResult.error.message,
      });
    } else if (updateResult.signal === "SIGTERM") {
      options.logger.warn("[deep-link] update-desktop-database 超时，已跳过", {
        desktopFilePath,
        timeoutMs: XDG_COMMAND_TIMEOUT_MS,
      });
    } else if (updateResult.status !== 0) {
      options.logger.warn("[deep-link] update-desktop-database 失败，已跳过", {
        desktopFilePath,
        status: updateResult.status,
        signal: updateResult.signal,
        stderr: updateResult.stderr?.trim(),
      });
    }
  } catch (error) {
    options.logger.warn("[deep-link] Linux 用户级协议注册异常", {
      desktopFilePath,
      desktopFileName: profile.desktopFileName,
      executablePath: command.executablePath,
      args: command.args,
      error,
    });
  }

  const iconInstallResult = systemDesktopEntryPath
    ? null
    : installLinuxAppImageDesktopIconBestEffort({
        dataDir,
        env: options.env,
        iconSourcePath: options.iconSourcePath,
        logger: options.logger,
        runCommand,
      });
  if (iconInstallResult) {
    options.logger.info("[deep-link] Linux AppImage 用户级图标安装完成", {
      protocolRegistered,
      iconFilePath: iconInstallResult.iconFilePath,
      iconInstalled: iconInstallResult.installed,
      iconChanged: iconInstallResult.changed,
    });
  }
}
