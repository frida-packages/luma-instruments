import CoreGraphics
import Foundation
import ImageIO
import LumaCore
import Metal
import UniformTypeIdentifiers

final class OffscreenRenderer {
    private let device: MTLDevice
    private let queue: MTLCommandQueue
    private let depthState: MTLDepthStencilState
    private let byIndex: MTLSamplerState
    private let acrossPicture: MTLSamplerState

    private static let vertexBufferIndex = 30
    private static let paramsBufferIndex = 1
    private static let transformWordOffset = 8 + 64
    private static let uniformWordCount = transformWordOffset + 16

    init() {
        device = MTLCreateSystemDefaultDevice()!
        queue = device.makeCommandQueue()!
        let depth = MTLDepthStencilDescriptor()
        depth.depthCompareFunction = .less
        depth.isDepthWriteEnabled = true
        depthState = device.makeDepthStencilState(descriptor: depth)!
        let exact = MTLSamplerDescriptor()
        exact.minFilter = .nearest
        exact.magFilter = .nearest
        byIndex = device.makeSamplerState(descriptor: exact)!
        let smooth = MTLSamplerDescriptor()
        smooth.minFilter = .linear
        smooth.magFilter = .linear
        acrossPicture = device.makeSamplerState(descriptor: smooth)!
    }

    func render(scene handle: Int, points: (Int, Int), scale: Int, dark: Bool, to path: String) -> String {
        guard let scene = CanvasRegistry.shared.scene(handle) else { return "no scene \(handle)" }
        let width = points.0 * scale
        let height = points.1 * scale
        let colorDescriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm, width: width, height: height, mipmapped: false)
        colorDescriptor.usage = [.renderTarget, .shaderRead]
        colorDescriptor.storageMode = .shared
        let color = device.makeTexture(descriptor: colorDescriptor)!
        let depthDescriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .depth32Float, width: width, height: height, mipmapped: false)
        depthDescriptor.usage = [.renderTarget]
        depthDescriptor.storageMode = .private
        let depth = device.makeTexture(descriptor: depthDescriptor)!

        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = color
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].storeAction = .store
        pass.colorAttachments[0].clearColor = dark
            ? MTLClearColor(red: 0.075, green: 0.050, blue: 0.065, alpha: 1)
            : MTLClearColor(red: 0.994, green: 0.991, blue: 0.986, alpha: 1)
        pass.depthAttachment.texture = depth
        pass.depthAttachment.loadAction = .clear
        pass.depthAttachment.clearDepth = 1
        pass.depthAttachment.storeAction = .dontCare

        let buffer = queue.makeCommandBuffer()!
        let encoder = buffer.makeRenderCommandEncoder(descriptor: pass)!
        encoder.setDepthStencilState(depthState)

        var uniforms = [Float](repeating: 0, count: Self.uniformWordCount)
        uniforms[0] = Float(width)
        uniforms[1] = Float(height)
        uniforms[3] = dark ? 0 : 1
        uniforms[7] = Float(scale)

        var notes: [String] = []
        var drawn = 0
        for handle in scene.order {
            guard let subject = scene.drawables[handle], subject.isVisible else { continue }
            guard subject.geometry.vertexCount > 0, let run = subject.geometry.vertices else { continue }
            guard let pipeline = pipeline(for: subject, notes: &notes) else { continue }
            for (offset, value) in subject.transform.prefix(16).enumerated() {
                uniforms[Self.transformWordOffset + offset] = value
            }
            encoder.setRenderPipelineState(pipeline)
            encoder.setVertexBytes(&uniforms, length: uniforms.count * 4, index: 0)
            encoder.setFragmentBytes(&uniforms, length: uniforms.count * 4, index: 0)
            var params = subject.packedParams(at: CanvasDriver.now)
            if !params.isEmpty {
                encoder.setVertexBytes(&params, length: params.count * 4, index: Self.paramsBufferIndex)
                encoder.setFragmentBytes(&params, length: params.count * 4, index: Self.paramsBufferIndex)
            }
            let textures = subject.buffers.map { sheet(for: $0) } + subject.images.map { picture(for: $0) }
            for (index, texture) in textures.enumerated() {
                encoder.setFragmentTexture(texture, index: index)
                encoder.setVertexTexture(texture, index: index)
                let sampler = index < subject.buffers.count ? byIndex : acrossPicture
                encoder.setFragmentSamplerState(sampler, index: index)
                encoder.setVertexSamplerState(sampler, index: index)
            }
            let vertices = run.bytes.withUnsafeBytes { raw in
                device.makeBuffer(bytes: raw.baseAddress!.advanced(by: run.offset), length: max(run.count, 1), options: [])!
            }
            encoder.setVertexBuffer(vertices, offset: 0, index: Self.vertexBufferIndex)
            encoder.drawPrimitives(type: primitive(subject.geometry.primitive), vertexStart: 0, vertexCount: subject.geometry.vertexCount)
            drawn += subject.geometry.vertexCount
        }
        encoder.endEncoding()
        buffer.commit()
        buffer.waitUntilCompleted()
        write(color, width: width, height: height, to: path)
        return "\(path): \(drawn) vertices" + (notes.isEmpty ? "" : " " + notes.joined(separator: "; "))
    }

    private func pipeline(for subject: CanvasDrawable, notes: inout [String]) -> MTLRenderPipelineState? {
        do {
            let vertexLibrary = try device.makeLibrary(source: subject.vertexMetal, options: nil)
            let fragmentLibrary = try device.makeLibrary(source: subject.fragmentMetal, options: nil)
            let descriptor = MTLRenderPipelineDescriptor()
            descriptor.vertexFunction = vertexLibrary.makeFunction(name: "canvasVertex")
            descriptor.fragmentFunction = fragmentLibrary.makeFunction(name: "canvasFragment")
            let vertexDescriptor = MTLVertexDescriptor()
            var offset = 0
            for (index, attribute) in subject.geometry.attributes.enumerated() {
                vertexDescriptor.attributes[index].format = [.float, .float2, .float3, .float4][attribute.components - 1]
                vertexDescriptor.attributes[index].offset = offset
                vertexDescriptor.attributes[index].bufferIndex = Self.vertexBufferIndex
                offset += attribute.components * 4
            }
            vertexDescriptor.layouts[Self.vertexBufferIndex].stride = offset
            descriptor.vertexDescriptor = vertexDescriptor
            descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
            descriptor.colorAttachments[0].isBlendingEnabled = true
            descriptor.colorAttachments[0].sourceRGBBlendFactor = .one
            descriptor.colorAttachments[0].sourceAlphaBlendFactor = .one
            descriptor.colorAttachments[0].destinationRGBBlendFactor = .oneMinusSourceAlpha
            descriptor.colorAttachments[0].destinationAlphaBlendFactor = .oneMinusSourceAlpha
            descriptor.depthAttachmentPixelFormat = .depth32Float
            return try device.makeRenderPipelineState(descriptor: descriptor)
        } catch {
            notes.append("pipeline failed: \(error)")
            return nil
        }
    }

    private func primitive(_ primitive: CanvasGeometry.Primitive) -> MTLPrimitiveType {
        switch primitive {
        case .points: return .point
        case .lines: return .line
        case .lineStrip: return .lineStrip
        case .triangles: return .triangle
        case .triangleStrip: return .triangleStrip
        }
    }

    private func sheet(for buffer: CanvasBuffer) -> MTLTexture {
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .r32Float, width: buffer.width, height: buffer.height, mipmapped: false)
        descriptor.usage = [.shaderRead]
        let texture = device.makeTexture(descriptor: descriptor)!
        buffer.padded().withUnsafeBytes { bytes in
            texture.replace(region: MTLRegionMake2D(0, 0, buffer.width, buffer.height), mipmapLevel: 0,
                            withBytes: bytes.baseAddress!, bytesPerRow: buffer.width * 4)
        }
        return texture
    }

    private func picture(for image: CanvasImage) -> MTLTexture {
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm, width: image.width, height: image.height, mipmapped: false)
        descriptor.usage = [.shaderRead]
        let texture = device.makeTexture(descriptor: descriptor)!
        image.pixels.withUnsafeBytes { bytes in
            texture.replace(region: MTLRegionMake2D(0, 0, image.width, image.height), mipmapLevel: 0,
                            withBytes: bytes.baseAddress!, bytesPerRow: image.width * 4)
        }
        return texture
    }

    private func write(_ texture: MTLTexture, width: Int, height: Int, to path: String) {
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        texture.getBytes(&pixels, bytesPerRow: width * 4, from: MTLRegionMake2D(0, 0, width, height), mipmapLevel: 0)
        let context = CGContext(
            data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
        let image = context.makeImage()!
        let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, image, nil)
        CGImageDestinationFinalize(destination)
    }
}
