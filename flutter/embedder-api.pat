#pragma abi native

struct PlatformMessage {
    u64 structSize;
    char *channel;
    u8 *message;
    u64 messageSize;
    u8 *responseHandle;
};

struct EngineProcTable {
    u64 structSize;
    u8 *createAotData;
    u8 *collectAotData;
    u8 *run;
    u8 *shutdown;
    u8 *initialize;
    u8 *deinitialize;
    u8 *runInitialized;
    u8 *sendWindowMetricsEvent;
    u8 *sendPointerEvent;
    u8 *sendKeyEvent;
    u8 *sendPlatformMessage;
    u8 *platformMessageCreateResponseHandle;
    u8 *platformMessageReleaseResponseHandle;
    u8 *sendPlatformMessageResponse;
};
