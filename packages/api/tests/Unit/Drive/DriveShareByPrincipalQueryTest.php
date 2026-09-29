<?php

declare(strict_types=1);

namespace Tests\Unit\Drive;

use App\Services\Drive\DriveShareByPrincipalQuery;
use Tests\TestCase;

final class DriveShareByPrincipalQueryTest extends TestCase
{
    private DriveShareByPrincipalQuery $query;

    protected function setUp(): void
    {
        parent::setUp();
        $this->query = app(DriveShareByPrincipalQuery::class);
    }

    public function test_principal_type_for_query(): void
    {
        $this->assertSame('group', $this->query->principalTypeForQuery('groups/eng'));
        $this->assertSame('email', $this->query->principalTypeForQuery('bob@example.com'));
        $this->assertSame('user', $this->query->principalTypeForQuery('alice'));
    }

    public function test_normalized_principal_for_response(): void
    {
        $this->assertSame('bob@example.com', $this->query->normalizedPrincipalForResponse('Bob@Example.com', 'email'));
        $this->assertSame('alice', $this->query->normalizedPrincipalForResponse('Alice', 'user'));
        $this->assertSame('groups/eng', $this->query->normalizedPrincipalForResponse('groups/eng', 'group'));
    }
}
