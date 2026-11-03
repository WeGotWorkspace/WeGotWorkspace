<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\CspFormActions;
use App\Support\SecurityHeaderPolicy;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class CspFormActionsTest extends TestCase
{
    /**
     * @return array<string, array{string, list<string>}>
     */
    public static function redirects(): array
    {
        return [
            'https callback keeps only the origin' => ['https://claude.ai/api/mcp/auth_callback?x=1', ['https://claude.ai']],
            'loopback port is kept' => ['http://127.0.0.1:33418/callback', ['http://127.0.0.1:33418']],
            'host is lowercased' => ['https://Claude.AI/cb', ['https://claude.ai']],
            'custom app scheme' => ['cursor://anysphere.cursor-mcp/oauth/callback', ['cursor:']],
            'javascript is refused' => ['javascript:alert(1)', []],
            'data is refused' => ['data:text/html,x', []],
            'policy injection is refused' => ['https://evil.example;script-src *', []],
            'no scheme is refused' => ['/oauth/callback', []],
        ];
    }

    /**
     * @param  list<string>  $expected
     */
    #[DataProvider('redirects')]
    public function test_allow_redirect_to(string $url, array $expected): void
    {
        $actions = new CspFormActions;
        $actions->allowRedirectTo($url);

        $this->assertSame($expected, $actions->sources());
    }

    public function test_duplicates_are_collapsed(): void
    {
        $actions = new CspFormActions;
        $actions->allowRedirectTo('https://claude.ai/a');
        $actions->allowRedirectTo('https://claude.ai/b');

        $this->assertSame(['https://claude.ai'], $actions->sources());
    }

    public function test_policy_keeps_self_and_appends_sources(): void
    {
        $this->assertStringContainsString("; form-action 'self'; ", SecurityHeaderPolicy::policy());
        $this->assertStringContainsString(
            "; form-action 'self' https://claude.ai; ",
            SecurityHeaderPolicy::policy(null, ['https://claude.ai']),
        );
    }
}
