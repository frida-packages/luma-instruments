#pragma abi native

struct MachHeader64 {
    u32 magic;
    u32 cpuType;
    u32 cpuSubtype;
    u32 fileType;
    u32 commandCount;
    u32 commandsSize;
    u32 flags;
    u32 reserved;
};

struct LoadCommand {
    u32 command;
    u32 size;
};

struct SegmentCommand64 {
    u32 command;
    u32 size;
    char name[16];
    u64 vmAddress;
    u64 vmSize;
    u64 fileOffset;
    u64 fileSize;
    u32 maxProtection;
    u32 initialProtection;
    u32 sectionCount;
    u32 flags;
};

struct Section64 {
    char name[16];
    char segmentName[16];
    u64 address;
    u64 size;
    u32 offset;
    u32 alignment;
    u32 relocationOffset;
    u32 relocationCount;
    u32 flags;
    u32 reserved1;
    u32 reserved2;
    u32 reserved3;
};

struct LinkeditDataCommand {
    u32 command;
    u32 size;
    u32 dataOffset;
    u32 dataSize;
};

struct Elf64Header {
    u8 identification[16];
    u16 type;
    u16 machine;
    u32 version;
    u64 entry;
    u64 programHeaderOffset;
    u64 sectionHeaderOffset;
    u32 flags;
    u16 headerSize;
    u16 programHeaderSize;
    u16 programHeaderCount;
    u16 sectionHeaderSize;
    u16 sectionHeaderCount;
    u16 sectionNameIndex;
};

struct Elf64ProgramHeader {
    u32 type;
    u32 flags;
    u64 offset;
    u64 virtualAddress;
    u64 physicalAddress;
    u64 fileSize;
    u64 memorySize;
    u64 alignment;
};

struct EhFrameHeader {
    u8 version;
    u8 framePointerEncoding;
    u8 countEncoding;
    u8 tableEncoding;
    s32 framePointer;
    u32 count;
};

struct EhFrameTableEntry {
    s32 start;
    s32 frame;
};
