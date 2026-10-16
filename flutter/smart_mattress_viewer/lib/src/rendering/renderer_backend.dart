import '../types.dart';

/// Each backend has its own immutable instance identity and model tokens.
abstract class RendererBackend {
  String? get instanceId;
  Stream<MattressEvent> get events;
  Future<dynamic> request(String method, List<Object?> args,
      {String? modelToken, Duration? timeout});
  void dispose();
}
