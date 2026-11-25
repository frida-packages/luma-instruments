import { type AppImage, type SnapshotFacts, appImageIn, snapshotFactsAt, snapshotFactsInFile } from "./app-snapshot.js";
import type { ChannelTraffic } from "./channel-log.js";
import { type EngineFacts, readEngineFacts } from "./engine-facts.js";
import { type FlutterFile, flutterFiles } from "./flutter-files.js";
import { type ChannelWatch, type FlutterPlatform, flutterPlatforms } from "./flutter-platforms.js";
import type { Settings } from "./settings.js";
import { type SnapshotStrings, type StringRegion, readSnapshotStrings } from "./snapshot-strings.js";
import { type VmService, findVmService } from "./vm-service.js";

export interface Findings {
    platform: FlutterPlatform;
    engine: Module;
    engineFacts: EngineFacts;
    channels: ChannelWatch;
    app: Module | null;
    appImage: AppImage | null;
    snapshot: SnapshotFacts | null;
    assets: string | null;
    files: FlutterFile[];
    strings: SnapshotStrings | null;
    vmService: ServiceLookup;
}

export type ServiceLookup =
    | { state: "unasked" }
    | { state: "asking" }
    | { state: "none" }
    | { state: "found"; service: VmService }
    | { state: "failed"; reason: string };

export interface FindingsObserver {
    onFindings(findings: Findings): void;
    onProblem(problem: string): void;
}

const KERNEL_FILE = /[\\/]kernel_blob\.bin$/;

export class FlutterInspection {
    readonly #settings: Settings;
    readonly #traffic: ChannelTraffic;
    readonly #observers: FindingsObserver[] = [];
    #moduleObserver: ModuleObserver | null = null;
    #pendingArrival: ReturnType<typeof setTimeout> | null = null;
    #findings: Findings | null = null;

    constructor(settings: Settings, traffic: ChannelTraffic) {
        this.#settings = settings;
        this.#traffic = traffic;
    }

    observe(observer: FindingsObserver): void {
        this.#observers.push(observer);
    }

    get findings(): Findings | null {
        return this.#findings;
    }

    start(): void {
        let attaching = true;
        let engineAtAttach: Module | null = null;
        this.#moduleObserver = Process.attachModuleObserver({
            onAdded: module => {
                if (attaching) {
                    engineAtAttach ??= this.#isEngine(module) ? module : null;
                } else {
                    this.#scheduleArrival(module);
                }
            },
        });
        attaching = false;
        if (engineAtAttach !== null) {
            this.#meetEngine(engineAtAttach);
        }
    }

    refresh(): void {
        const findings = this.#findings;
        if (findings === null) {
            return;
        }
        findings.files = flutterFiles(findings.engine, findings.app, findings.appImage !== null, findings.assets);
        this.#notify();
        this.#askVmService(findings);
    }

    dispose(): void {
        this.#moduleObserver?.detach();
        if (this.#pendingArrival !== null) {
            clearTimeout(this.#pendingArrival);
        }
        this.#findings?.channels.dispose();
    }

    #isEngine(module: Module): boolean {
        return flutterPlatforms.some(platform => platform.engineLibrary.test(module.name));
    }

    #scheduleArrival(module: Module): void {
        const findings = this.#findings;
        const awaited = (findings === null) ? this.#isEngine(module) : findings.app === null && findings.platform.appLibrary.test(module.name);
        if (awaited && this.#pendingArrival === null) {
            this.#pendingArrival = setTimeout(() => this.#arrive(module), 0);
        }
    }

    #arrive(module: Module): void {
        this.#pendingArrival = null;
        if (this.#findings === null) {
            this.#meetEngine(module);
        } else {
            this.#meetApp(this.#findings, module);
        }
    }

    #meetEngine(engine: Module): void {
        const platform = flutterPlatforms.find(candidate => candidate.engineLibrary.test(engine.name))!;
        const findings: Findings = {
            platform,
            engine,
            engineFacts: readEngineFacts(engine),
            channels: this.#watchChannels(platform, engine),
            app: null,
            appImage: null,
            snapshot: null,
            assets: platform.assetsDirectory(null),
            files: [],
            strings: null,
            vmService: { state: "unasked" },
        };
        this.#findings = findings;
        const app = Process.enumerateModules().find(module => platform.appLibrary.test(module.name));
        if (app !== undefined) {
            this.#meetApp(findings, app);
        } else {
            findings.files = flutterFiles(engine, null, false, findings.assets);
            this.#notify();
        }
        this.#askVmService(findings);
    }

    #watchChannels(platform: FlutterPlatform, engine: Module): ChannelWatch {
        try {
            return platform.watchChannels(engine, this.#traffic);
        } catch (e) {
            const reason = `Could not watch channels: ${(e as Error).message}`;
            this.#report(reason);
            return { how: reason, watching: false, dispose() {} };
        }
    }

    #meetApp(findings: Findings, app: Module): void {
        findings.app = app;
        findings.appImage = appImageIn(app);
        findings.assets = findings.platform.assetsDirectory(app);
        findings.files = flutterFiles(findings.engine, app, findings.appImage !== null, findings.assets);
        findings.snapshot = this.#snapshotOf(findings);
        this.#notify();
        setTimeout(() => this.#readStrings(findings), 0);
    }

    #snapshotOf(findings: Findings): SnapshotFacts | null {
        if (findings.appImage !== null) {
            return snapshotFactsAt(findings.appImage.isolateData, true);
        }
        const isolateData = findings.files.find(file => file.id === "isolate_snapshot_data");
        return (isolateData !== undefined) ? snapshotFactsInFile(isolateData.path) : null;
    }

    #readStrings(findings: Findings): void {
        findings.strings = readSnapshotStrings(stringRegionsOf(findings));
        this.#notify();
    }

    #askVmService(findings: Findings): void {
        if (!this.#settings.askVmService) {
            findings.vmService = { state: "unasked" };
            return;
        }
        findings.vmService = { state: "asking" };
        this.#notify();
        findVmService()
            .then(service => {
                findings.vmService = (service !== null) ? { state: "found", service } : { state: "none" };
            }, (e: Error) => {
                findings.vmService = { state: "failed", reason: e.message };
            })
            .finally(() => this.#notify());
    }

    #notify(): void {
        for (const observer of this.#observers) {
            observer.onFindings(this.#findings!);
        }
    }

    #report(problem: string): void {
        for (const observer of this.#observers) {
            observer.onProblem(problem);
        }
    }
}

function stringRegionsOf(findings: Findings): StringRegion[] {
    if (findings.appImage !== null) {
        const { module, isolateData } = findings.appImage;
        const section = module.enumerateSections()
            .find(candidate => isolateData.compare(candidate.address) >= 0 && isolateData.compare(candidate.address.add(candidate.size)) < 0);
        return (section !== undefined) ? [{ base: section.address, size: section.size }] : [{ base: module.base, size: module.size }];
    }
    return Process.enumerateRanges("r--").filter(range => range.file !== undefined && KERNEL_FILE.test(range.file.path));
}
