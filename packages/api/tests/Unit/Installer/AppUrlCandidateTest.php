<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Services\Installer\AppUrlCandidate;
use PHPUnit\Framework\TestCase;

final class AppUrlCandidateTest extends TestCase
{
    public function test_accepts_origin_and_install_base_path(): void
    {
        $this->assertSame('https://wgw.example', AppUrlCandidate::normalize('https://wgw.example/', '/'));
        $this->assertSame('https://wgw.example/office', AppUrlCandidate::normalize('https://wgw.example/office/', '/office/'));
        $this->assertSame('http://203.0.113.10:8080', AppUrlCandidate::normalize('http://203.0.113.10:8080', '/'));
    }

    public function test_rejects_scheme_userinfo_query_and_extra_path(): void
    {
        $this->assertNull(AppUrlCandidate::normalize('javascript:alert(1)', '/'));
        $this->assertNull(AppUrlCandidate::normalize('https://user:secret@wgw.example', '/'));
        $this->assertNull(AppUrlCandidate::normalize('https://wgw.example/?next=https://evil.example', '/'));
        $this->assertNull(AppUrlCandidate::normalize('https://wgw.example/other', '/office'));
        $this->assertNull(AppUrlCandidate::normalize('https://wgw.example/office/extra', '/office'));
        $this->assertNull(AppUrlCandidate::normalize('ftp://wgw.example', '/'));
    }
}
