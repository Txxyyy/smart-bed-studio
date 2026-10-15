import 'dart:convert';

enum Side { left, right }

enum AirStatus { idle, inflating, deflating, adjusting, fault }

enum HeatingStatus { off, heating, holding, fault }

enum MassageStatus { off, running, paused, fault }

enum CameraPreset { perspective, leftFoot, rightFoot, top, side }

enum PerformanceMode { auto, native, eco, balanced, high }

// `static` is a Dart keyword; the public name is staticImage.
enum RenderPolicy { auto, threeD, twoD, staticImage }

enum RenderMode { threeD, twoD, staticImage }

class FallbackOptions {
  final Duration threeDAttemptBudget;
  final Duration contextRestoreBudget;
  const FallbackOptions({
    this.threeDAttemptBudget = const Duration(seconds: 6),
    this.contextRestoreBudget = const Duration(seconds: 2),
  });
}

class RendererInfo {
  final RenderPolicy requestedPolicy;
  final RenderMode activeMode;
  final String phase;
  final String? reasonCode;
  final int attemptId;
  const RendererInfo(
      {required this.requestedPolicy,
      required this.activeMode,
      this.phase = 'ready',
      this.reasonCode,
      this.attemptId = 0});

  Map<String, bool> get capabilities => {
        'interactiveCamera': activeMode == RenderMode.threeD,
        'geometryDeformation': activeMode == RenderMode.threeD,
        'layerViews': activeMode == RenderMode.threeD,
        'regionEffects': true,
        'poseDiagram': activeMode != RenderMode.threeD,
        'dynamicEffects': activeMode != RenderMode.staticImage,
      };
}

class MattressException implements Exception {
  final String code;
  final String message;
  const MattressException(this.code, this.message);
  @override
  String toString() => 'MattressException($code): $message';
}

class AirState {
  final num? value;
  final AirStatus? status;
  final bool _unknown;
  const AirState({this.value, this.status}) : _unknown = false;
  const AirState.unknown()
      : value = null,
        status = null,
        _unknown = true;
  Map<String, Object?> toJson() => {
        if (value != null || _unknown) 'value': value,
        if (status != null || _unknown) 'status': status?.name,
      };
}

class HeatingState {
  final int? level;
  final HeatingStatus? status;
  const HeatingState({this.level, this.status});
  Map<String, Object?> toJson() => {
        if (level != null) 'level': level,
        if (status != null) 'status': status!.name,
      };
}

class MassageState {
  final MassageStatus? status;
  final double? intensity;
  final double? cycleSeconds;
  const MassageState({this.status, this.intensity, this.cycleSeconds});
  Map<String, Object?> toJson() => {
        if (status != null) 'status': status!.name,
        if (intensity != null) 'intensity': intensity,
        if (cycleSeconds != null) 'cycleSeconds': cycleSeconds,
      };
}

class PoseTarget {
  final double angle;
  final double degreesPerSecond;
  const PoseTarget(this.angle, {this.degreesPerSecond = 3});
  Map<String, Object> toJson() =>
      {'angle': angle, 'degreesPerSecond': degreesPerSecond};
}

/// JSON is copied at the boundary. Use explicit null in a patch to mark unknown;
/// omitted keys preserve state, while zero is a real value.
class MattressState {
  final String _json;
  MattressState.fromJson(Map<String, Object?> data) : _json = jsonEncode(data);
  MattressState(
      {Map<String, AirState>? air,
      Map<String, HeatingState>? heating,
      Map<Side, MassageState>? massage,
      Map<String, num?>? pose,
      bool? online})
      : _json = jsonEncode({
          if (air != null)
            'air': air.map((key, value) => MapEntry(key, value.toJson())),
          if (heating != null)
            'heating':
                heating.map((key, value) => MapEntry(key, value.toJson())),
          if (massage != null)
            'massage':
                massage.map((key, value) => MapEntry(key.name, value.toJson())),
          if (pose != null) 'pose': pose,
          if (online != null) 'online': online,
        });
  Map<String, dynamic> toJson() => jsonDecode(_json) as Map<String, dynamic>;
}

class MattressModelInfo {
  final String _json;
  MattressModelInfo(Map<String, dynamic> data) : _json = jsonEncode(data);
  Map<String, dynamic> get json => jsonDecode(_json) as Map<String, dynamic>;
  String get id => json['id'] as String;
  String get modelToken => json['modelToken'] as String;
  int get revision => json['revision'] as int;
  List<Map<String, dynamic>> get regions =>
      (json['regions'] as List).cast<Map<String, dynamic>>();
  List<Map<String, dynamic>> get heating =>
      (json['heating'] as List).cast<Map<String, dynamic>>();
  bool get supportsMassage => (json['massage'] as List).isNotEmpty;
  bool get supportsTidal => json['waistCircuits'] != null;
  int get airbagCount => json['airbagCount'] as int;
}

class MattressEvent {
  final String name;
  final Map<String, dynamic> data;
  final String? modelToken;
  const MattressEvent(this.name, this.data, this.modelToken);
}
