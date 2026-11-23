#pragma abi native

struct BufferDesc {
    u32 byteWidth;
    u32 usage;
    u32 bindFlags;
    u32 cpuAccessFlags;
    u32 miscFlags;
    u32 structureByteStride;
};

struct SubresourceData {
    u8 *sysMem;
    u32 sysMemPitch;
    u32 sysMemSlicePitch;
};

struct QueryDesc {
    u32 query;
    u32 miscFlags;
};

struct InputElementDesc {
    char *semanticName;
    u32 semanticIndex;
    u32 format;
    u32 inputSlot;
    u32 alignedByteOffset;
    u32 inputSlotClass;
    u32 instanceDataStepRate;
};
