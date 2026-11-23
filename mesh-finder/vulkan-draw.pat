struct Binding {
    u64 buffer;
    u64 offset;
    u64 stride;
};

struct Draw {
    u8 *commandBuffer : u64;
    u64 driver;
    u64 pipeline;
    u64 topology;
    u64 vertexInput;
    u64 latestVertexInput;
    u64 elements;
    u64 indexBuffer;
    u64 indexOffset;
    u64 indexType;
    u64 count;
    u64 first;
    s64 vertexOffset;
    u64 indirectBuffer;
    u64 indirectOffset;
    u64 drawCount;
    u64 indirectStride;
    u64 bound;
    Binding bindings[32];
};
