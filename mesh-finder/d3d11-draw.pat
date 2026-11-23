struct DrawSlot {
    u8 *buffer : u64;
    u64 stride;
    u64 offset;
};

struct Draw {
    u8 *device : u64;
    u64 kind;
    u8 *layout : u64;
    u64 topology;
    u8 *indexBuffer : u64;
    u64 indexFormat;
    u64 indexOffset;
    u64 indexCount;
    u64 startIndex;
    s64 baseVertex;
    u64 vertexCount;
    u64 startVertex;
    u8 *indirectBuffer : u64;
    u64 indirectOffset;
    u64 bound;
    DrawSlot slots[32];
};
