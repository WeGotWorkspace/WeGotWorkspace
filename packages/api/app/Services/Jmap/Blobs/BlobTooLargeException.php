<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

/**
 * A blob over maxSizeUpload, or a body PHP discarded for exceeding
 * post_max_size. Answered with the RFC 8620 `limit` problem.
 */
final class BlobTooLargeException extends \RuntimeException {}
