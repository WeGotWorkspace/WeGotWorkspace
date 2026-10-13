<?php

declare(strict_types=1);

namespace App\Services\Search;

final class SearchTokenService
{
    public const MAX_QUERY_TOKENS = 10;

    /**
     * Indexing passes no cap. Search passes {@see self::MAX_QUERY_TOKENS} so one
     * query cannot fan out into an unbounded set of LIKE scans.
     *
     * @return list<string>
     */
    public function tokenize(string $text, ?int $maxTokens = null): array
    {
        $normalized = $this->normalizeToken(mb_strtolower(trim($text)));
        if ($normalized === '') {
            return [];
        }

        $parts = preg_split('/[^\\pL\\pN]+/u', $normalized) ?: [];
        $tokens = [];
        $seen = [];
        foreach ($parts as $part) {
            $token = $this->normalizeToken(trim($part));
            if ($token === '' || mb_strlen($token) < 2) {
                continue;
            }
            // Avoid $tokens[$token] — PHP casts numeric strings to int array keys.
            if (isset($seen[$token])) {
                continue;
            }
            $seen[$token] = true;
            $tokens[] = $token;
            if ($maxTokens !== null && count($tokens) >= $maxTokens) {
                break;
            }
        }

        return $tokens;
    }

    public function normalizeToken(string $value): string
    {
        if ($value === '' || ! class_exists(\Normalizer::class)) {
            return $value;
        }

        $normalized = \Normalizer::normalize($value, \Normalizer::FORM_C);

        return is_string($normalized) && $normalized !== '' ? $normalized : $value;
    }
}
