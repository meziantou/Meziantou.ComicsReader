import SwiftUI
import UIKit

enum SwipeDirection {
    case left
    case right
}

/// Displays an image that can be zoomed with a pinch gesture. Drags are only reported when the image is not zoomed.
struct ZoomableImageView: UIViewRepresentable {
    let image: UIImage
    var onHorizontalDragChanged: (_ translation: CGFloat) -> Void
    var onHorizontalDragEnded: (_ translation: CGFloat, _ velocity: CGFloat) -> Void
    var onVerticalSwipe: () -> Void
    var onTap: (() -> Void)?
    var onDoubleTap: (() -> Void)?

    func makeUIView(context: Context) -> ZoomingImageScrollView {
        let view = ZoomingImageScrollView()
        view.image = image
        return view
    }

    func updateUIView(_ view: ZoomingImageScrollView, context: Context) {
        view.image = image
        view.onHorizontalDragChanged = onHorizontalDragChanged
        view.onHorizontalDragEnded = onHorizontalDragEnded
        view.onVerticalSwipe = onVerticalSwipe
        view.onTap = onTap
        view.onDoubleTap = onDoubleTap
    }
}

final class ZoomingImageScrollView: UIScrollView, UIScrollViewDelegate {
    static let verticalSwipeDistance: CGFloat = 50

    private enum PanAxis {
        case undetermined
        case horizontal
        case vertical
        case ignored
    }

    private let imageView = UIImageView()
    private var lastLayoutSize = CGSize.zero
    private let panRecognizer = UIPanGestureRecognizer()
    private let simultaneousGestureDelegate = SimultaneousGestureDelegate()
    private let singleTapRecognizer = UITapGestureRecognizer()
    private let doubleTapRecognizer = UITapGestureRecognizer()
    private var panAxis = PanAxis.ignored

    var onHorizontalDragChanged: ((CGFloat) -> Void)?
    var onHorizontalDragEnded: ((CGFloat, CGFloat) -> Void)?
    var onVerticalSwipe: (() -> Void)?

    var onTap: (() -> Void)? {
        didSet { singleTapRecognizer.isEnabled = onTap != nil }
    }

    var onDoubleTap: (() -> Void)? {
        didSet { doubleTapRecognizer.isEnabled = onDoubleTap != nil }
    }

    var image: UIImage? {
        get { imageView.image }
        set {
            guard newValue !== imageView.image else {
                return
            }

            imageView.image = newValue
            resetZoom()
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)

        delegate = self
        minimumZoomScale = 1
        maximumZoomScale = 5
        bouncesZoom = true
        showsVerticalScrollIndicator = false
        showsHorizontalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        decelerationRate = .fast
        backgroundColor = .clear

        imageView.contentMode = .scaleAspectFit
        imageView.accessibilityIgnoresInvertColors = true
        addSubview(imageView)

        // The page follows the finger, and the navigation is decided only when the finger is lifted
        // Don't name the action handlePan(_:), as it would override the private method UIScrollView uses to scroll
        panRecognizer.addTarget(self, action: #selector(handlePageDrag(_:)))
        panRecognizer.maximumNumberOfTouches = 1
        panRecognizer.delegate = simultaneousGestureDelegate
        addGestureRecognizer(panRecognizer)

        singleTapRecognizer.addTarget(self, action: #selector(handleTap))
        singleTapRecognizer.isEnabled = false
        addGestureRecognizer(singleTapRecognizer)

        doubleTapRecognizer.numberOfTapsRequired = 2
        doubleTapRecognizer.addTarget(self, action: #selector(handleDoubleTap))
        doubleTapRecognizer.isEnabled = false
        addGestureRecognizer(doubleTapRecognizer)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layoutSubviews() {
        super.layoutSubviews()

        if bounds.size != lastLayoutSize {
            lastLayoutSize = bounds.size
            resetZoom()
        }

        centerContent()
    }

    private func resetZoom() {
        zoomScale = 1
        let fittedSize = fittedImageSize()
        imageView.frame = CGRect(origin: .zero, size: fittedSize)
        contentSize = fittedSize
        contentOffset = .zero
        centerContent()
    }

    private func fittedImageSize() -> CGSize {
        guard let image = imageView.image, image.size.width > 0, image.size.height > 0, bounds.width > 0, bounds.height > 0 else {
            return bounds.size
        }

        let ratio = min(bounds.width / image.size.width, bounds.height / image.size.height)
        return CGSize(width: image.size.width * ratio, height: image.size.height * ratio)
    }

    private func centerContent() {
        let horizontalInset = max(0, (bounds.width - contentSize.width) / 2)
        let verticalInset = max(0, (bounds.height - contentSize.height) / 2)
        contentInset = UIEdgeInsets(top: verticalInset, left: horizontalInset, bottom: verticalInset, right: horizontalInset)
    }

    private var isZoomed: Bool {
        zoomScale > minimumZoomScale + 0.01
    }

    @objc private func handlePageDrag(_ recognizer: UIPanGestureRecognizer) {
        // Use the window coordinates, as the view moves with the finger
        let translation = recognizer.translation(in: nil)

        // When the image is zoomed, the pan gesture of the scroll view moves the image
        if recognizer.state == .began {
            panAxis = isZoomed ? .ignored : .undetermined
        }

        // Cancel the page drag when a pinch starts during the drag
        if panAxis != .ignored && (isZooming || isZoomed) {
            if panAxis == .horizontal {
                onHorizontalDragEnded?(0, 0)
            }

            panAxis = .ignored
        }

        // The translation is zero when the gesture begins, so the axis is determined on the first move
        if panAxis == .undetermined && translation != .zero {
            panAxis = abs(translation.x) >= abs(translation.y) ? .horizontal : .vertical
        }

        switch (recognizer.state, panAxis) {
        case (.began, .horizontal), (.changed, .horizontal):
            onHorizontalDragChanged?(translation.x)
        case (.ended, .horizontal):
            onHorizontalDragEnded?(translation.x, recognizer.velocity(in: nil).x)
        case (.cancelled, .horizontal), (.failed, .horizontal):
            onHorizontalDragEnded?(0, 0)
        case (.ended, .vertical) where abs(translation.y) > Self.verticalSwipeDistance:
            onVerticalSwipe?()
        default:
            break
        }
    }

    @objc private func handleTap() {
        onTap?()
    }

    @objc private func handleDoubleTap() {
        onDoubleTap?()
    }

    // UIScrollViewDelegate

    func viewForZooming(in scrollView: UIScrollView) -> UIView? {
        imageView
    }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        centerContent()
    }
}

/// Allows the page drag to be recognized with the gestures of the scroll view.
/// The scroll view is not the delegate, as it would override the delegate methods UIScrollView implements for its own gestures.
private final class SimultaneousGestureDelegate: NSObject, UIGestureRecognizerDelegate {
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        true
    }
}
