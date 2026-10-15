/**
 * 构建期开关：为真时安装包使用 Preview 身份，而后端环境仍由 `ZCODE_ENV` 单独决定。
 * 典型用法是 `ZCODE_ENV=production ZCODE_PREVIEW_IDENTITY=1`，得到一个连接生产后端、
 * 可与正式版并排安装的 `ZCode Preview`。
 */
export const ZCODE_PREVIEW_IDENTITY_ENV = "ZCODE_PREVIEW_IDENTITY";

/**
 * WebFlix 产品身份开关（freeze §6.1，BINDING）。`WEBFLIX_IDENTITY=1` 时桌面产品身份
 * 切换为 WebFlix：appId/AUMID `org.webflix.desktop`（dev AUMID `org.webflix.desktop.dev`）、
 * productName `WebFlix`、协议 `webflix://`、数据根 `~/.webflix`（dev `~/.webflix-dev`）、
 * Linux 包名 `webflix-desktop*`。与 ZCode 任何身份面（`cn.aminer.zcode`、`zcode://`、
 * `~/.zcode`、`zcode-desktop*`）互斥共存（freeze §6.1 coexistence）。关闭时保持 ZCode
 * 行为完全不变（迁移期 `ZCODE_*` 环境别名继续生效）。拼写与 Preview 开关同一套严格
 * 语义：只有 `1` 开启，其它非空拼写直接报错，fail-closed。
 */
export const WEBFLIX_IDENTITY_ENV = "WEBFLIX_IDENTITY";

const PRODUCTION_IDENTITY = Object.freeze({
  flavor: "production",
  appId: "dev.zcode.app",
  productName: "ZCode",
  linuxExecutableName: "zcode",
  linuxPackageName: "zcode",
  cuaHelperInstallVariant: null,
  /** P8-RELEASE-DRIFT-1（R3/R4）：深链协议 scheme 集中到身份模块（此前在 builder 配置硬编码）。 */
  scheme: "zcode",
  /** P8-RELEASE-DRIFT-1（R4）：产物元数据（extraMetadata/deb maintainer）随身份切换。 */
  homepage: "https://zcode.z.ai",
  authorName: "ZCode",
  authorEmail: "dev@zcode.z.ai",
  /** Windows 安装清单文件名（electron-builder.config.js 写入产物）。 */
  installManifestName: ".zcode-install-manifest",
  /** 开发态更新实验的下载缓存目录名（dev-app-update.yml）。 */
  updaterCacheDirName: "zcode-dev-updater",
  /*
   * P9-LINUX-1：Linux desktop entry Comment 与 deb/rpm control Description 的
   * 解析源（electron-builder LinuxTargetHelper.getDescription：linux.description
   * 优先，缺省回落 package.json description，即 "ZCode Desktop App"）。生产/Preview
   * 显式保持与回落值逐字相同，零行为变化；WebFlix 不得携带 ZCode 字样
   * （freeze §6.1 产品面——run 38657065806 证据：desktop entry Comment 与 deb
   * control Description 曾泄漏 "ZCode Desktop App"）。值由 productName 推导，
   * 不属于 PROPOSED homepage/author/maintainer 一类待定元数据。
   */
  desktopEntryDescription: "ZCode Desktop App",
});

const PREVIEW_IDENTITY = Object.freeze({
  flavor: "preview",
  appId: "dev.zcode.app.preview",
  productName: "ZCode Preview",
  linuxExecutableName: "zcode-preview",
  linuxPackageName: "zcode-preview",
  cuaHelperInstallVariant: "preview",
  scheme: "zcode",
  homepage: "https://zcode.z.ai",
  authorName: "ZCode",
  authorEmail: "dev@zcode.z.ai",
  installManifestName: ".zcode-install-manifest",
  updaterCacheDirName: "zcode-dev-updater",
  // 见 PRODUCTION_IDENTITY.desktopEntryDescription 注释（P9-LINUX-1）：Preview 与
  // 生产共用同一描述，保持现状回落值，零行为变化。
  desktopEntryDescription: "ZCode Desktop App",
});

/**
 * WebFlix 身份（freeze §6.1 冻结值；镜像模块 packages/webflix-shell/src/identity.ts
 * 的 identity.test.ts 逐值钉死这些字段）。linuxPackageBase 推导自 linuxPackageName：
 * `webflix-desktop` / dev 变体 `webflix-desktop-dev`，glob `webflix-desktop*`。
 */
const WEBFLIX_DESKTOP_IDENTITY = Object.freeze({
  flavor: "webflix",
  appId: "org.webflix.desktop",
  productName: "WebFlix",
  linuxExecutableName: "webflix",
  linuxPackageName: "webflix-desktop",
  linuxPackageGlob: "webflix-desktop*",
  /** 深链协议（注册/匹配形如 `webflix://`）。 */
  scheme: "webflix",
  /** 生产数据根（Electron userData 基准）。 */
  dataRoot: ".webflix",
  /** 开发数据根：dev 状态与生产隔离（freeze §6.1/§6.8）。 */
  devDataRoot: ".webflix-dev",
  /** 开发态 AUMID。修复 AUDIT-DESKTOP 缺陷：ZCode dev 复用生产 AUMID `cn.aminer.zcode`，
   * 导致 dev 与生产共享 Toast 通知身份；WebFlix dev 使用独立 `org.webflix.desktop.dev`。 */
  devAumid: "org.webflix.desktop.dev",
  cuaHelperInstallVariant: null,
  /*
   * P8-RELEASE-DRIFT-1（R4）——以下三个值是【提案】（PROPOSED），freeze §6.1 未冻结
   * homepage/author/maintainer 值；按冻结身份（appId `org.webflix.desktop`、产品名
   * `WebFlix`）一致性推导：域名取 appId 反转域的裸域，邮箱镜像 ZCode 的 dev@<domain>
   * 形状。交付说明中逐项标记待 TL2 复核；替换真实值只需改这里 + 测试钉死值。
   */
  homepage: "https://webflix.org",
  authorName: "WebFlix",
  authorEmail: "dev@webflix.org",
  /** Windows 安装清单文件名：WebFlix 产物不再携带 `.zcode-install-manifest`。 */
  installManifestName: ".webflix-install-manifest",
  /** WebFlix 开发态更新实验缓存目录名（当前更新器对 WebFlix fail-closed 拒绝，见 H1）。 */
  updaterCacheDirName: "webflix-dev-updater",
  /*
   * P9-LINUX-1：WebFlix 的 Linux desktop entry Comment / deb control Description。
   * run 38657065806 证据修复：此前回落 package.json description，把 "ZCode Desktop App"
   * 带进 WebFlix desktop entry 与 deb 元数据（freeze §6.1 产品面不允许）。由
   * productName 推导（同 installManifestName 的推导层级，非 PROPOSED 待定值）。
   */
  desktopEntryDescription: "WebFlix Desktop App",
});

export const desktopProductIdentities = Object.freeze({
  production: PRODUCTION_IDENTITY,
  preview: PREVIEW_IDENTITY,
  webflix: WEBFLIX_DESKTOP_IDENTITY,
});

function normalizeDesktopZCodeEnv(env) {
  return env.ZCODE_ENV?.trim().toLowerCase() === "production" ? "production" : "test";
}

/**
 * 开关只有一种开启拼写 `1`（`0` / 空 = 关闭），与 CI workflow 规则和 release 门的
 * `$ZCODE_PREVIEW_IDENTITY == "1"` 精确比较保持同一套语义。其它拼写在构建期直接失败，
 * 避免 `true` 之类在 YAML 路由层漏匹配、却在脚本层被当成开启，把 Preview 包打进生产验收目录。
 */
export function isPreviewIdentityRequested(env = process.env) {
  const value = env[ZCODE_PREVIEW_IDENTITY_ENV]?.trim() ?? "";
  if (value === "1") {
    return true;
  }
  if (value === "" || value === "0") {
    return false;
  }
  throw new Error(
    `invalid ${ZCODE_PREVIEW_IDENTITY_ENV}=${env[ZCODE_PREVIEW_IDENTITY_ENV]}; expected 1 or 0`,
  );
}

/**
 * 运行时身份选项（P8-RELEASE-DRIFT-1 R2，TL2 裁决）：`flavor` 是烤进包里的
 * `__ZCODE_PRODUCT_FLAVOR__` 运行时常量（ZCODE_PRODUCT_FLAVOR），`isPackaged`
 * 是 Electron `app.isPackaged`。构建侧调用（bundle/e2e）不传 options，行为不变。
 *
 * @typedef {object} WebFlixRuntimeIdentityOptions
 * @property {"production" | "preview" | "webflix"} [flavor]
 * @property {boolean} [isPackaged]
 */

/**
 * WebFlix 身份请求解析（fail-closed，拼写语义与 isPreviewIdentityRequested 一致）。
 * 默认关闭：不设置 `WEBFLIX_IDENTITY` 时桌面维持 ZCode 身份，迁移零影响。
 *
 * P8-RELEASE-DRIFT-1（R2，审计 §1.5）：显式环境变量优先（1 强制开、0/空 强制关、
 * 其它拼写直接报错）；未设置时，烤入 flavor 为 `"webflix"` 且打包态（isPackaged）
 * 默认开启——打包引导链上没有任何东西会设置 `WEBFLIX_IDENTITY`，身份必须
 * 跟随烤入值（`~/.webflix`，freeze §6.1）。开发态（isPackaged !== true）保持
 * 默认关闭、`WEBFLIX_IDENTITY=1` 显式 opt-in（`~/.webflix-dev`）。
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {WebFlixRuntimeIdentityOptions} [options]
 * @returns {boolean}
 */
export function isWebFlixIdentityRequested(env = process.env, options = {}) {
  const value = env[WEBFLIX_IDENTITY_ENV]?.trim() ?? "";
  if (value === "1") {
    return true;
  }
  if (value === "0") {
    // 显式强制关闭（两个上下文都生效，TL2 裁决）：优先于烤入 flavor 的默认开启。
    return false;
  }
  if (value === "") {
    // 未显式请求：打包 + 烤入 webflix flavor → 默认开启（R2）。
    return options.flavor === "webflix" && options.isPackaged === true;
  }
  throw new Error(`invalid ${WEBFLIX_IDENTITY_ENV}=${env[WEBFLIX_IDENTITY_ENV]}; expected 1 or 0`);
}

/**
 * 解析当前产品身份（ZCode production/preview 或 WebFlix）。WebFlix 优先于 Preview：
 * WebFlix 是产品轴（另一个产品），ZCODE_ENV 决定的是 ZCode 后端环境轴；两者同时显式
 * 开启属于配置错误，直接报错而不是静默选边。
 */
export function resolveDesktopProductFlavor(env = process.env) {
  const webflix = isWebFlixIdentityRequested(env);
  const preview = isPreviewIdentityRequested(env);
  if (webflix && preview) {
    throw new Error(
      `invalid identity request: ${WEBFLIX_IDENTITY_ENV}=1 and ${ZCODE_PREVIEW_IDENTITY_ENV}=1 are mutually exclusive`,
    );
  }
  if (webflix) {
    return "webflix";
  }
  if (preview) {
    return "preview";
  }
  return normalizeDesktopZCodeEnv(env) === "production" ? "production" : "preview";
}

export function resolveDesktopProductIdentity(env = process.env) {
  return desktopProductIdentities[resolveDesktopProductFlavor(env)];
}

/**
 * 产物文件名后缀标记的是后端环境而不是身份：`_TEST` 只出现在测试后端的安装包上。
 * 生产后端的 Preview 包靠 productName（`ZCode Preview-<version>-...`）与正式包区分。
 */
export function resolveDesktopArtifactSuffix(env = process.env) {
  return normalizeDesktopZCodeEnv(env) === "test" ? "_TEST" : "";
}

/**
 * 返回 Windows Shell 使用的 AppUserModelId。
 *
 * 打包态必须复用 electron-builder 的 appId，否则快捷方式里的 AUMID、开始菜单索引
 * 和运行中的 Electron 进程会被 Windows 视为三个不同的应用。开发态继续保留旧身份，
 * 避免本地调试快捷方式和正式/Preview 安装包互相污染。
 *
 * WebFlix（freeze §6.1 + AUDIT-DESKTOP dev-AUMID 缺陷修复）：dev 态返回独立的
 * `org.webflix.desktop.dev`，绝不返回 `cn.aminer.zcode`（该值在任何 WebFlix 身份面上
 * 被冻结禁止——见 resolveWindowsAppUserModelIdForFlavor 的运行时护栏）。
 */
export function resolveWindowsAppUserModelIdForFlavor(flavor, runtime = { isPackaged: true }) {
  if (flavor === "webflix") {
    if (runtime.isPackaged === false) {
      return WEBFLIX_DESKTOP_IDENTITY.devAumid;
    }
    return WEBFLIX_DESKTOP_IDENTITY.appId;
  }
  if (runtime.isPackaged === false) {
    return "cn.aminer.zcode";
  }
  return desktopProductIdentities[flavor === "preview" ? "preview" : "production"].appId;
}

export function resolveWindowsAppUserModelId(env = process.env, runtime = { isPackaged: true }) {
  return resolveWindowsAppUserModelIdForFlavor(resolveDesktopProductFlavor(env), runtime);
}

/**
 * WebFlix 数据根解析（freeze §6.1）：打包态 `~/.webflix`，开发态 `~/.webflix-dev`。
 * 显式覆盖 `WEBFLIX_DATA_ROOT` 优先（测试隔离用）；返回相对于 HOME 的目录名，
 * 调用方负责拼接。非 WebFlix 身份返回 undefined，调用方保持原 ZCode 路径。
 * 绝不允许 WebFlix 身份落到 `~/.zcode`（freeze coexistence）。
 *
 * P8-RELEASE-DRIFT-1（R2）：runtime 新增 `flavor`（烤入的运行时身份常量），
 * 与 isWebFlixIdentityRequested 同一套默认开启规则。
 */
export function resolveWebFlixDataRootName(env = process.env, runtime = { isPackaged: true }) {
  if (
    !isWebFlixIdentityRequested(env, {
      flavor: runtime.flavor,
      isPackaged: runtime.isPackaged,
    })
  ) {
    return undefined;
  }
  const override = env.WEBFLIX_DATA_ROOT?.trim();
  if (override) {
    return override;
  }
  return runtime.isPackaged === false
    ? WEBFLIX_DESKTOP_IDENTITY.devDataRoot
    : WEBFLIX_DESKTOP_IDENTITY.dataRoot;
}

/**
 * 运行时护栏（freeze §6.1 coexistence 执法点）：给定解析出的桌面身份与 AUMID，
 * 断言 WebFlix 身份面上永不出现被冻结禁止的 ZCode 值。违规直接抛错——宁可启动失败
 * 也不能带着错误身份装进用户系统（AUDIT-DESKTOP dev-AUMID 缺陷的回归护栏）。
 */
export function assertWebFlixIdentityNeverLeaksZCode(identity) {
  const forbidden = new Set(["cn.aminer.zcode", "zcode://", ".zcode", "zcode-desktop"]);
  for (const [field, value] of Object.entries(identity)) {
    if (typeof value === "string" && forbidden.has(value)) {
      throw new Error(
        `WebFlix identity leaked forbidden ZCode value on ${field}: ${value} (freeze §6.1 coexistence)`,
      );
    }
  }
  return true;
}
