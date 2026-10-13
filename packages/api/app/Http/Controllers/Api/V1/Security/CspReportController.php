<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Security;

use App\Http\Middleware\CspReportBodyLimit;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Log;

final class CspReportController
{
    public function __invoke(Request $request): Response
    {
        $body = $request->attributes->get(CspReportBodyLimit::BODY_ATTRIBUTE);
        // The route middleware always sets this. A missing value means that
        // middleware was removed; still accept, and do not invent a 400.
        Log::channel('csp')->info('csp.report', $this->context(is_string($body) ? $body : ''));

        return response()->noContent();
    }

    /**
     * @return array<string, int|string>
     */
    private function context(string $body): array
    {
        $context = ['bytes' => strlen($body)];
        $decoded = json_decode($body, true);
        if (! is_array($decoded)) {
            return $context;
        }
        $report = $decoded['csp-report'] ?? $decoded;
        if (! is_array($report)) {
            return $context;
        }

        foreach (['document-uri', 'violated-directive', 'effective-directive', 'blocked-uri', 'disposition'] as $key) {
            $value = $report[$key] ?? null;
            if (is_string($value) && $value !== '') {
                $context[$key] = substr(preg_replace('/[\x00-\x1F\x7F]+/', ' ', $value) ?? '', 0, 200);
            }
        }

        return $context;
    }
}
