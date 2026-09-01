<?php

declare(strict_types=1);

namespace App\Http\Support;

use Illuminate\Http\Request;

/**
 * Reject requests that already exceeded PHP's post_max_size before Laravel
 * renders a response. The SAPI emits a line-0 warning (often HTML, status 200)
 * when display_errors=On; callers must also start PHP with display_errors=0.
 */
final class WgwOversizedPost
{
    /**
     * @return array{error: string, code: string}
     */
    public static function payload(?string $postMaxSize = null): array
    {
        $max = trim($postMaxSize ?? (string) ini_get('post_max_size'));
        $hint = $max !== ''
            ? "Current server post_max_size is {$max}."
            : 'Current server post_max_size is too low.';

        return [
            'error' => "Upload too large. {$hint}",
            'code' => 'post_too_large',
        ];
    }

    public static function iniBytes(string $value): int
    {
        $trimmed = strtolower(trim($value));
        if ($trimmed === '' || $trimmed === '0') {
            return 0;
        }

        $unit = substr($trimmed, -1);
        $number = $trimmed;
        $factor = 1;
        if (! is_numeric($unit)) {
            $number = substr($trimmed, 0, -1);
            $factor = match ($unit) {
                'g' => 1024 ** 3,
                'm' => 1024 ** 2,
                'k' => 1024,
                default => 1,
            };
        }

        return (int) round((float) $number * $factor);
    }

    public static function contentLength(?Request $request = null): int
    {
        if ($request instanceof Request) {
            $raw = $request->server->get('CONTENT_LENGTH', $request->header('Content-Length', 0));

            return is_numeric($raw) ? (int) $raw : 0;
        }

        $raw = $_SERVER['CONTENT_LENGTH'] ?? $_SERVER['HTTP_CONTENT_LENGTH'] ?? 0;

        return is_numeric($raw) ? (int) $raw : 0;
    }

    public static function exceedsLimit(?Request $request = null, ?int $contentLength = null): bool
    {
        $max = self::iniBytes((string) ini_get('post_max_size'));
        if ($max <= 0) {
            return false;
        }

        $length = $contentLength ?? self::contentLength($request);

        return $length > $max;
    }

    public static function abortIfExceeded(): void
    {
        if (! self::exceedsLimit()) {
            return;
        }

        while (ob_get_level() > 0) {
            ob_end_clean();
        }

        http_response_code(413);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(self::payload(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }
}
