<?php

declare(strict_types=1);

namespace Tests\Unit\Search;

use App\Services\Search\SearchTokenService;
use PHPUnit\Framework\TestCase;

final class SearchTokenServiceTest extends TestCase
{
    public function test_deduplicates_tokens_with_mixed_unicode_representations(): void
    {
        $service = new SearchTokenService;
        $precomposed = 'één';
        $decomposed = "e\u{0301}én";
        $text = $precomposed.' '.$decomposed.' '.$precomposed;

        $tokens = $service->tokenize($text);

        $this->assertCount(1, $tokens);
        $this->assertSame('één', $tokens[0]);
    }

    public function test_skips_single_character_tokens(): void
    {
        $service = new SearchTokenService;

        $this->assertSame([], $service->tokenize('a b c'));
    }

    public function test_keeps_numeric_tokens_as_strings(): void
    {
        $service = new SearchTokenService;

        $tokens = $service->tokenize('Roadmap 2026 release');

        $this->assertContains('2026', $tokens);
        $this->assertSame('string', gettype($tokens[array_search('2026', $tokens, true)]));
    }

    public function test_query_tokenization_stops_after_ten_tokens(): void
    {
        $service = new SearchTokenService;
        $words = [];
        for ($i = 1; $i <= 11; $i++) {
            $words[] = sprintf('token%02d', $i);
        }
        $text = implode(' ', $words);

        $capped = $service->tokenize($text, SearchTokenService::MAX_QUERY_TOKENS);

        $this->assertSame(array_slice($words, 0, 10), $capped);
        $this->assertNotContains('token11', $capped);
        $this->assertCount(11, $service->tokenize($text));
    }
}
