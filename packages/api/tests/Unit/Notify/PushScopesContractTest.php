<?php

declare(strict_types=1);

namespace Tests\Unit\Notify;

use App\Services\Notify\PushScopes;
use PHPUnit\Framework\TestCase;

/** The scopes the server accepts are the ones the OpenAPI contract lists (#1606). */
final class PushScopesContractTest extends TestCase
{
    public function test_known_scopes_match_the_openapi_push_scope_enum(): void
    {
        $path = dirname(__DIR__, 3).'/openapi/schemas/notify/notifications.json';
        /** @var array{PushScope: array{enum: list<string>}} $schemas */
        $schemas = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);

        $this->assertSame(PushScopes::KNOWN, $schemas['PushScope']['enum']);
    }
}
