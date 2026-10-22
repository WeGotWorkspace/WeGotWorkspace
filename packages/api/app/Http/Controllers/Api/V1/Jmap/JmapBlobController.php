<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Jmap;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Support\JmapProblem;
use App\Http\Support\RangeResponder;
use App\Http\Support\WgwOversizedPost;
use App\Services\Jmap\Assembly\BlobClaimService;
use App\Services\Jmap\Blobs\BlobTooLargeException;
use App\Services\Jmap\Blobs\JmapBlobMaintenance;
use App\Services\Jmap\Blobs\JmapBlobService;
use App\Services\Jmap\Blobs\JmapDownloadBlobResolver;
use App\Services\Jmap\Blobs\PartMismatchException;
use App\Services\Jmap\Blobs\StorageFullException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * JMAP blob upload/download (RFC 8620 §6, #438), replacing the 501 stubs.
 *
 * Download serves blobIds from ALL stores that surface ids through the
 * envelope: the envelope store (JmapBlobService, `jb-…`), the contacts REST
 * blob store (ContactBlobService, UUID-shaped), and drive file content via
 * node-derived `fnb-…` ids (FileNodeBlobResolver, #450) — every blobId the
 * envelope surfaces must be downloadable through the Session's downloadUrl.
 * Downloads stream with single-range support (RangeResponder, #1500).
 */
final class JmapBlobController
{
    public function __construct(
        private readonly JmapBlobService $blobs,
        private readonly JmapDownloadBlobResolver $downloads,
        private readonly RangeResponder $ranges,
        private readonly BlobClaimService $claims,
        private readonly JmapBlobMaintenance $maintenance,
    ) {}

    public function upload(Request $request, string $accountId): JsonResponse
    {
        $username = $this->username($request);
        if ($accountId !== $username) {
            return $this->notFoundProblem('Account not found.');
        }

        $declaredLength = $this->declaredPartLength($request);
        $declaredSha256 = $this->declaredPartSha256($request);
        if ($declaredLength === false || $declaredSha256 === false) {
            return JmapProblem::badRequest('Wgw-Part-Length must be a byte count and Wgw-Part-Sha256 64 hex characters.');
        }

        $max = JmapBlobService::maxSizeUpload();
        $contentLength = WgwOversizedPost::declaredContentLength($request);
        if (($contentLength !== null && $contentLength > $max) || ($declaredLength !== null && $declaredLength > $max)) {
            // RFC 8620 §6.1: over-limit uploads get the `limit` problem type
            // with limit: maxSizeUpload — before a byte is read.
            return JmapProblem::limit('maxSizeUpload', 'The file is larger than maxSizeUpload.');
        }

        $mediaType = (string) $request->header('Content-Type', 'application/octet-stream');
        // Strip parameters (e.g. "; charset=…") — the type is echoed back
        // and stored as the blob's media type.
        $mediaType = trim(explode(';', $mediaType, 2)[0]);

        // PHP empties an oversized POST body and the front-controller guard
        // only sees it through Content-Length: an empty body with any sign
        // of a discard is the `limit` problem, never an empty part.
        $emptyMeansDiscarded = WgwOversizedPost::emptyBodyLooksDiscarded($request)
            || WgwOversizedPost::phpWarnedPostTooLarge()
            || ($contentLength !== null && $contentLength > 0)
            || ($declaredLength !== null && $declaredLength > 0);

        $body = $request->getContent(true);
        try {
            $stored = $this->blobs->storeStream($username, $mediaType, $body, $declaredLength, $declaredSha256, $emptyMeansDiscarded);
        } catch (BlobTooLargeException $e) {
            return JmapProblem::limit('maxSizeUpload', $e->getMessage());
        } catch (PartMismatchException $e) {
            return JmapProblem::partMismatch($e->details);
        } catch (StorageFullException) {
            return JmapProblem::insufficientStorage();
        } finally {
            if (is_resource($body)) {
                fclose($body);
            }
        }

        $assemblyId = $request->header('Wgw-Assembly-Id');
        if (is_string($assemblyId) && $assemblyId !== '') {
            $this->claims->claim($username, $assemblyId, $stored['blobId']);
        }
        $this->maintenance->maybeRun();

        return response()->json([
            'accountId' => $username,
            'blobId' => $stored['blobId'],
            'type' => $stored['type'],
            'size' => $stored['size'],
        ], 201);
    }

    /**
     * null = header absent; false = present but malformed.
     */
    private function declaredPartLength(Request $request): int|false|null
    {
        $raw = $request->header('Wgw-Part-Length');
        if (! is_string($raw) || $raw === '') {
            return null;
        }

        return ctype_digit($raw) && strlen($raw) <= 18 ? (int) $raw : false;
    }

    private function declaredPartSha256(Request $request): string|false|null
    {
        $raw = $request->header('Wgw-Part-Sha256');
        if (! is_string($raw) || $raw === '') {
            return null;
        }

        return preg_match('/^[0-9a-fA-F]{64}$/', $raw) === 1 ? strtolower($raw) : false;
    }

    public function download(Request $request, string $accountId, string $blobId, string $name): Response
    {
        $username = $this->username($request);
        if ($accountId !== $username) {
            return $this->notFoundProblem('Account not found.');
        }

        $blob = $this->downloads->resolve($username, $blobId);
        $stream = $blob?->open();
        if ($blob === null || $stream === null) {
            return $this->notFoundProblem('Blob not found.');
        }

        $type = $request->query('type');
        $contentType = is_string($type) && $type !== ''
            ? $this->sanitizeHeaderValue($type)
            : $blob->mediaType;

        return $this->ranges->respond($request, $stream, [
            'Content-Type' => $contentType,
            'Content-Disposition' => 'attachment; filename="'.$this->sanitizeHeaderValue($name).'"',
            // Blob content is immutable per blobId (content-addressed).
            'Cache-Control' => 'private, immutable, max-age=31536000',
        ]);
    }

    private function username(Request $request): string
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return (string) $principal['username'];
    }

    private function notFoundProblem(string $detail): JsonResponse
    {
        return response()
            ->json(['type' => 'about:blank', 'status' => 404, 'detail' => $detail], 404)
            ->header('Content-Type', 'application/problem+json');
    }

    private function sanitizeHeaderValue(string $value): string
    {
        return str_replace(["\r", "\n", '"'], '', $value);
    }
}
