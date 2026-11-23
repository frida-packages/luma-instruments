#pragma abi native

struct Box {
    u32 left;
    u32 top;
    u32 front;
    u32 right;
    u32 bottom;
    u32 back;
};

struct MappedSubresource {
    u8 *data;
    u32 rowPitch;
    u32 depthPitch;
};
