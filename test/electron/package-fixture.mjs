import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [electronApp, fixture, outApp, layout, tools] = process.argv.slice(2);
const require = createRequire(join(tools, "package.json"));
const asar = require("@electron/asar");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

const resources = join(outApp, "Contents", "Resources");
const plist = join(outApp, "Contents", "Info.plist");

rmSync(outApp, { recursive: true, force: true });
execFileSync("cp", ["-Rc", electronApp, outApp]);
rmSync(join(resources, "default_app.asar"));
execFileSync("plutil", ["-remove", "ElectronAsarIntegrity", plist]);
execFileSync("plutil", ["-insert", "LSUIElement", "-bool", "YES", plist]);
execFileSync("plutil", ["-replace", "CFBundleIdentifier", "-string", `re.frida.luma.electron-fixture.${layout}`, plist]);

const staging = mkdtempSync(join(tmpdir(), "fixture-"));
cpSync(fixture, staging, { recursive: true });
if (layout === "esm") {
    const manifest = JSON.parse(readFileSync(join(staging, "package.json"), "utf8"));
    manifest.main = "main.mjs";
    writeFileSync(join(staging, "package.json"), JSON.stringify(manifest, null, 2));
}

if (layout === "dir") {
    cpSync(staging, join(resources, "app"), { recursive: true });
} else {
    const archive = join(resources, "app.asar");
    await asar.createPackageWithOptions(staging, archive, { unpackDir: "unpacked" });
    const hash = createHash("sha256").update(asar.getRawHeader(archive).headerString).digest("hex");
    const integrity = { "Resources/app.asar": { algorithm: "SHA256", hash } };
    execFileSync("plutil", ["-insert", "ElectronAsarIntegrity", "-json", JSON.stringify(integrity), plist]);
}
rmSync(staging, { recursive: true });

if (layout === "asar") {
    await flipFuses(outApp, {
        version: FuseVersion.V1,
        resetAdHocDarwinSignature: true,
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
    });
}

execFileSync("codesign", ["--force", "--deep", "--sign", "-", outApp], { stdio: "ignore" });
console.log(`${outApp}: ${layout}`);
