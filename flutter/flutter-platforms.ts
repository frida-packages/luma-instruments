import type { ChannelTraffic } from "./channel-log.js";
import { watchMacosChannels } from "./macos-channels.js";

export interface FlutterPlatform {
    readonly name: string;
    readonly engineLibrary: RegExp;
    readonly appLibrary: RegExp;
    assetsDirectory(app: Module | null): string | null;
    watchChannels(engine: Module, traffic: ChannelTraffic): ChannelWatch;
}

export interface ChannelWatch {
    readonly how: string;
    readonly watching: boolean;
    dispose(): void;
}

export const flutterPlatforms: FlutterPlatform[] = [
    {
        name: "macOS",
        engineLibrary: /^FlutterMacOS$/,
        appLibrary: /^App$/,
        assetsDirectory: app => (app !== null) ? `${parentOf(app.path)}/Resources/flutter_assets` : null,
        watchChannels: watchMacosChannels,
    },
    {
        name: "iOS",
        engineLibrary: /^Flutter$/,
        appLibrary: /^App$/,
        assetsDirectory: app => (app !== null) ? `${parentOf(app.path)}/flutter_assets` : null,
        watchChannels: () => unwatched("Channels are not decoded on iOS yet: its engine dispatches them in stripped C++"),
    },
    {
        name: "Android",
        engineLibrary: /^libflutter\.so$/,
        appLibrary: /^libapp\.so$/,
        assetsDirectory: () => null,
        watchChannels: () => unwatched("Channels are not decoded on Android yet"),
    },
    {
        name: "Linux",
        engineLibrary: /^libflutter_linux_gtk\.so$/,
        appLibrary: /^libapp\.so$/,
        assetsDirectory: () => `${parentOf(Process.mainModule.path)}/data/flutter_assets`,
        watchChannels: () => unwatched("Channels are not decoded on Linux yet"),
    },
    {
        name: "Windows",
        engineLibrary: /^flutter_windows\.dll$/i,
        appLibrary: /^app\.so$/,
        assetsDirectory: () => `${parentOf(Process.mainModule.path)}\\data\\flutter_assets`,
        watchChannels: () => unwatched("Channels are not decoded on Windows yet"),
    },
];

function parentOf(path: string): string {
    return path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
}

function unwatched(how: string): ChannelWatch {
    return {
        how,
        watching: false,
        dispose() {
        },
    };
}
