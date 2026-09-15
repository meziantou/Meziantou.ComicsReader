import SwiftUI
import UIKit

enum SwipeDirection {
    case left
    case right
    case up
    case down
}

/// Displays an image that can be zoomed with a pinch gesture. Swipes are only reported when the image is not zoomed.
struct ZoomableImageView: UIViewRepresentable {
    let image: UIImage
    var onSwipe: (SwipeDirection) -> Void
    var onTap: (() -> Void)?
    var onDoubleTap: (() -> Void)?

    func makeUIView(context: Context) -> ZoomingImageScrollView {
        let view = ZoomingImageScrollView()
        view.image = image
        return view
    }

    func updateUIView(_ view: ZoomingImageScrollView, context: Context) {
        view.image = image
        view.onSwipe = onSwipe
        view.onTap = onTap
        view.onDoubleTap = onDoubleTap
    }
}

final class ZoomingImageScrollView: UIScrollView, UIScrollViewDelegate, UIGestureRecognizerDelegate {
    private let imageView = UIImageView()
    private var lastLayoutSize = CGSize.zero
    private let singleTapRecognizer = UITapGestureRecognizer()
    private let doubleTapRecognizer = UITapGestureRecognizer()

    var onSwipe: ((SwipeDirection) -> Void)?

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

        for direction in [UISwipeGestureRecognizer.Direction.left, .right, .up, .down] {
            let recognizer = UISwipeGestureRecognizer(target: self, action: #selector(handleSwipe(_:)))
            recognizer.direction = direction
            recognizer.delegate = self
            addGestureRecognizer(recognizer)
        }

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

    @objc private func handleSwipe(_ recognizer: UISwipeGestureRecognizer) {
        switch recognizer.direction {
        case .left: onSwipe?(.left)
        case .right: onSwipe?(.right)
        case .up: onSwipe?(.up)
        case .down: onSwipe?(.down)
        default: break
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

    // UIGestureRecognizerDelegate

    override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        if gestureRecognizer is UISwipeGestureRecognizer {
            return !isZoomed
        }

        return super.gestureRecognizerShouldBegin(gestureRecognizer)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        true
    }
}
