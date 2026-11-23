struct Slot {
    u8 *buffer : u64;
    u64 offset;
    u64 stride;
    u8 *bytes : u64;
    u64 bytesLength;
    u64 bytesDigest;
    u64 boundAfterDraws;
};

struct Draw {
    u8 *pipeline : u64;
    u64 primitive;
    u64 indexType;
    u8 *indexBuffer : u64;
    u64 indexOffset;
    u64 indexCount;
    u64 vertexStart;
    u64 vertexCount;
    s64 baseVertex;
    u64 instanceCount;
    u8 *indirectBuffer : u64;
    u64 indirectOffset;
    u32 bound;
    padding[4];
    u32 mayHoldVertices;
    padding[4];
    Slot slots[31];
};
