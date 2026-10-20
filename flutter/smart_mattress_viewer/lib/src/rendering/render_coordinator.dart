import 'dart:async';

/// One budget that only runs while the candidate can draw.
class ActiveRenderBudget {
  Duration remaining;
  final void Function() expired;
  Timer? _timer;
  Stopwatch? _watch;
  bool _done = false;
  ActiveRenderBudget(this.remaining, this.expired);
  void setActive(bool active) {
    if (_done) return;
    if (!active) {
      _timer?.cancel();
      _timer = null;
      if (_watch != null) {
        remaining -= _watch!.elapsed;
        _watch!.stop();
        _watch = null;
      }
    } else if (_timer == null) {
      _watch = Stopwatch()..start();
      _timer = Timer(remaining > Duration.zero ? remaining : Duration.zero, () {
        _done = true;
        _watch?.stop();
        expired();
      });
    }
  }

  void cancel() {
    _done = true;
    _timer?.cancel();
    _watch?.stop();
  }
}
