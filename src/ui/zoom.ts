export function preventPageZoom(documentRef: Document): void {
  const preventGesture: EventListener = (event) => {
    if (event.cancelable) event.preventDefault();
  };
  const preventMultiTouchZoom: EventListener = (event) => {
    const touchEvent = event as TouchEvent;
    if (touchEvent.touches.length > 1 && event.cancelable) event.preventDefault();
  };

  documentRef.addEventListener('gesturestart', preventGesture, { capture: true, passive: false });
  documentRef.addEventListener('gesturechange', preventGesture, { capture: true, passive: false });
  documentRef.addEventListener('gestureend', preventGesture, { capture: true, passive: false });
  documentRef.addEventListener('touchmove', preventMultiTouchZoom, {
    capture: true,
    passive: false,
  });
}
