import type { Discovery } from "./catalog.js";
import type { Candidate, ObjectSource } from "./scan.js";
import { parseCertificate } from "./x509.js";

const mallocAlignment = 16;
const smallestPlausibleInstance = 128;
const largestPlausibleCertificate = 1 << 20;

export function findSecurityFramework(): ObjectSource | null {
    const security = Process.findModuleByName("Security");
    return (security !== null) ? new SecCertificateSource(security) : null;
}

class SecCertificateSource implements ObjectSource {
    readonly strategy = "SecCertificate" as const;
    readonly holder: string;
    private readonly classOfCfTypes: NativePointer;
    private readonly isaMask: NativePointer;
    private readonly certificateTypeId: number;
    private readonly mallocSize: NativeFunction<UInt64, [NativePointerValue]>;
    private readonly typeIdOf: NativeFunction<UInt64, [NativePointerValue]>;
    private readonly bytesOf: NativeFunction<NativePointer, [NativePointerValue]>;
    private readonly lengthOf: NativeFunction<Int64, [NativePointerValue]>;

    constructor(security: Module) {
        const objc = Process.getModuleByName("libobjc.A.dylib");
        const coreFoundation = Process.getModuleByName("CoreFoundation");
        const getClass = new NativeFunction(objc.getExportByName("objc_getClass"), "pointer", ["pointer"]);
        const certificateTypeIdOf = new NativeFunction(security.getExportByName("SecCertificateGetTypeID"), "size_t", []);

        this.holder = security.name;
        this.classOfCfTypes = getClass(Memory.allocUtf8String("__NSCFType"));
        this.isaMask = objc.getExportByName("objc_debug_isa_class_mask").readPointer();
        this.certificateTypeId = certificateTypeIdOf().toNumber();
        this.mallocSize = new NativeFunction(Module.getGlobalExportByName("malloc_size"), "size_t", ["pointer"]);
        this.typeIdOf = new NativeFunction(coreFoundation.getExportByName("CFGetTypeID"), "size_t", ["pointer"]);
        this.bytesOf = new NativeFunction(security.getExportByName("SecCertificateGetBytePtr"), "pointer", ["pointer"]);
        this.lengthOf = new NativeFunction(security.getExportByName("SecCertificateGetLength"), "ssize_t", ["pointer"]);
    }

    findCandidates(ranges: MemoryRange[]): Candidate[] {
        const instances = Memory.findPointers(ranges, [this.classOfCfTypes], { mask: this.isaMask });
        return instances.map(({ address }) => () => this.examine(address));
    }

    private examine(candidate: NativePointer): Discovery | null {
        if (!this.isLiveCertificate(candidate)) {
            return null;
        }
        const length = this.lengthOf(candidate).toNumber();
        if (length <= 0 || length > largestPlausibleCertificate) {
            return null;
        }
        const bytes = this.bytesOf(candidate);
        const der = bytes.readByteArray(length)!;
        return {
            der,
            certificate: parseCertificate(new Uint8Array(der)),
            sighting: { strategy: this.strategy, address: candidate, derAddress: bytes, holder: this.holder },
        };
    }

    private isLiveCertificate(candidate: NativePointer): boolean {
        return candidate.and(mallocAlignment - 1).isNull()
            && this.mallocSize(candidate).toNumber() >= smallestPlausibleInstance
            && this.typeIdOf(candidate).toNumber() === this.certificateTypeId;
    }
}
