<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars\Imip;

use App\Services\Calendars\Imip\Dkim\DkimKeyStore;
use App\Services\Calendars\Imip\Dkim\DnsTxtAnswer;
use Illuminate\Cache\ArrayStore;
use Illuminate\Cache\Repository;
use PHPUnit\Framework\TestCase;
use Tests\Support\FakeDnsTxtResolver;

/**
 * DKIM key lookups (#1589): names are checked before any query, answers are
 * cached, failed lookups are not.
 */
final class DkimKeyStoreTest extends TestCase
{
    private FakeDnsTxtResolver $dns;

    private ArrayStore $store;

    protected function setUp(): void
    {
        parent::setUp();
        $this->dns = new FakeDnsTxtResolver([
            's1._domainkey.example.test' => ['v=DKIM1; p=abc'],
            'down._domainkey.example.test' => FakeDnsTxtResolver::FAIL,
        ]);
        $this->store = new ArrayStore;
    }

    public function test_a_found_record_is_cached_for_an_hour(): void
    {
        $first = $this->keys()->lookup('S1', 'Example.TEST.');
        $second = $this->keys()->lookup('s1', 'example.test');

        $this->assertSame(DnsTxtAnswer::FOUND, $first?->status);
        $this->assertSame(['v=DKIM1; p=abc'], $second?->records);
        $this->assertSame(['s1._domainkey.example.test'], $this->dns->queries);
        $this->assertSame(DkimKeyStore::FOUND_TTL_SECONDS, $this->ttl());
    }

    public function test_no_record_is_cached_for_ten_minutes(): void
    {
        $this->keys()->lookup('gone', 'example.test');
        $answer = $this->keys()->lookup('gone', 'example.test');

        $this->assertSame(DnsTxtAnswer::NONE, $answer?->status);
        $this->assertCount(1, $this->dns->queries);
        $this->assertSame(DkimKeyStore::NONE_TTL_SECONDS, $this->ttl());
    }

    public function test_a_failed_lookup_is_asked_again(): void
    {
        $this->keys()->lookup('down', 'example.test');
        $answer = $this->keys()->lookup('down', 'example.test');

        $this->assertSame(DnsTxtAnswer::ERROR, $answer?->status);
        $this->assertCount(2, $this->dns->queries);
    }

    public function test_names_that_are_not_dns_names_are_never_queried(): void
    {
        foreach ([['a b', 'example.test'], ['s1', 'example.test/x'], ['s1', "example.test\0"], ['', 'example.test'], ['s1', str_repeat('a', 64).'.test'], ['-s', 'example.test']] as [$selector, $domain]) {
            $this->assertNull($this->keys()->lookup($selector, $domain), $selector.' '.$domain);
        }
        $this->assertSame([], $this->dns->queries);
        $this->assertSame('sel.2026._domainkey.example.test', DkimKeyStore::recordName('sel.2026', 'example.test'));
    }

    private function keys(): DkimKeyStore
    {
        return new DkimKeyStore($this->dns, new Repository($this->store));
    }

    private function ttl(): int
    {
        $property = new \ReflectionProperty(ArrayStore::class, 'storage');
        /** @var array<string, array{value: mixed, expiresAt: float|int}> $storage */
        $storage = $property->getValue($this->store);
        $entry = array_values($storage)[0] ?? null;

        return $entry === null ? 0 : (int) round($entry['expiresAt'] - microtime(true));
    }
}
