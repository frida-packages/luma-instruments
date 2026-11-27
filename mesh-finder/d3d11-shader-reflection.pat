struct DxbcHeader {
    u32 magic;
    padding[16];
    u32 version;
    u32 totalSize;
    u32 chunkCount;
};

struct DxbcChunk {
    u32 fourCC;
    u32 size;
};

struct ResourceDefinitions {
    u32 constantBufferCount;
    u32 constantBufferOffset;
    u32 boundResourceCount;
    u32 boundResourceOffset;
};

struct ResourceBinding {
    u32 nameOffset;
    u32 type;
    u32 returnType;
    u32 dimension;
    u32 sampleCount;
    u32 bindPoint;
    u32 bindCount;
    u32 flags;
};
