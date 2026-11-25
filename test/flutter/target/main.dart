import 'dart:async';
import 'dart:isolate';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

const methods = MethodChannel('luma.test/methods');
const json = MethodChannel('luma.test/json', JSONMethodCodec());
const events = EventChannel('luma.test/events');
const strings = BasicMessageChannel<String>('luma.test/strings', StringCodec());
const jsonMessages = BasicMessageChannel<Object?>('luma.test/json-messages', JSONMessageCodec());
const standardMessages = BasicMessageChannel<Object?>('luma.test/standard-messages', StandardMessageCodec());
const binary = BasicMessageChannel<ByteData>('luma.test/binary', BinaryCodec());

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  methods.setMethodCallHandler((call) async => {'dart': call.method, 'echo': call.arguments});
  strings.setMessageHandler((message) async => 'dart got $message');
  events.receiveBroadcastStream('subscribe').listen((_) {}, onError: (_) {});
  Isolate.spawn(backgroundWork, 'worker', debugName: 'channel-worker');
  Timer.periodic(const Duration(seconds: 1), (_) => exercise());
  runApp(const MaterialApp(home: Text('Channel target')));
}

void backgroundWork(String name) {
  var count = 0;
  Timer.periodic(const Duration(seconds: 1), (_) => count++);
}

var round = 0;

Future<void> exercise() async {
  round++;
  await methods.invokeMethod('echo', {
    'round': round,
    'name': 'Ada',
    'flags': [true, false, null],
    'small': 42,
    'large': 1 << 40,
    'ratio': 0.25,
    'bytes': Uint8List.fromList([0xde, 0xad, 0xbe, 0xef]),
    'ints': Int32List.fromList([1, -2, 3]),
    'longs': Int64List.fromList([1 << 33]),
    'doubles': Float64List.fromList([1.5, -2.5]),
    'floats': Float32List.fromList([0.5]),
    'nested': {'list': [1, 'two', 3.0], 7: 'int key'},
    'unicode': 'blåbær ✓',
  });
  try {
    await methods.invokeMethod('fail');
  } on PlatformException catch (_) {}
  try {
    await methods.invokeMethod('missing', 'nothing');
  } on MissingPluginException catch (_) {}
  await json.invokeMethod('lookup', {'query': 'flutter', 'page': round});
  await strings.send('dart says $round');
  await jsonMessages.send({'round': round, 'items': ['a', 'b']});
  await standardMessages.send([round, 'standard', 3.5]);
  await binary.send(ByteData.sublistView(Uint8List.fromList([1, 2, 3, round & 0xff])));
  if (kDebugMode && round == 1) {
    debugPrint('channel target running');
  }
}
