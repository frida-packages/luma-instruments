import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';

const port = 47443;
const responseSize = 3000;
final requestBody = List<int>.generate(5000, (i) => i % 251);

void main() {
  runApp(const SizedBox());
  unawaited(fetchForever());
}

Future<void> fetchForever() async {
  var client = newClient();
  for (var round = 1; ; round++) {
    try {
      final get = await client.getUrl(Uri.parse('https://localhost:$port/payload/$responseSize'));
      final response = await get.close();
      final received = await response.fold<int>(0, (total, chunk) => total + chunk.length);
      final post = await client.postUrl(Uri.parse('https://localhost:$port/digest'));
      post.contentLength = requestBody.length;
      post.add(requestBody);
      final reply = await utf8.decodeStream(await post.close());
      stdout.writeln('round $round: $received bytes, digest $reply');
    } catch (e) {
      stdout.writeln('round $round: $e');
    }
    if (round % 3 == 0) {
      client.close(force: true);
      client = newClient();
    }
    await Future<void>.delayed(const Duration(seconds: 2));
  }
}

HttpClient newClient() {
  return HttpClient()..badCertificateCallback = (certificate, host, port) => host == 'localhost';
}
