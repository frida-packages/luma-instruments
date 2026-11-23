struct IsaBits {
    u8 *classMask : u64;
    u8 *magicMask : u64;
    u8 *magicValue : u64;
};

struct BufferFacts {
    u8 *contents : u64;
    u64 length;
    u64 storageMode;
    u64 gpuAddress;
};
