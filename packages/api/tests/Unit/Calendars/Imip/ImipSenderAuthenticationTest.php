<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars\Imip;

use App\Services\Calendars\Imip\AuthenticationResults;
use App\Services\Calendars\Imip\ImipSenderAuthentication;
use App\Services\Calendars\Imip\MailAddress;
use App\Services\Calendars\Imip\MailHeaders;
use PHPUnit\Framework\TestCase;

final class ImipSenderAuthenticationTest extends TestCase
{
    public function test_parses_real_world_headers(): void
    {
        $gmail = AuthenticationResults::parse('mx.google.com; dkim=pass header.i=@example.com header.s=s1 header.b=abc; spf=pass (google.com: domain of a@example.com designates 1.2.3.4 as permitted sender) smtp.mailfrom=a@example.com; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=example.com');
        $this->assertNotNull($gmail);
        $this->assertSame('mx.google.com', $gmail->serverId);
        $this->assertSame(['dkim', 'spf', 'dmarc'], array_column($gmail->methods, 'method'));
        $this->assertSame('example.com', $gmail->methods[2]['props']['header.from']);

        $outlook = AuthenticationResults::parse('spf=pass (sender IP is 1.2.3.4) smtp.mailfrom=contoso.com; dkim=pass (signature was verified) header.d=contoso.com;dmarc=pass action=none header.from=contoso.com;compauth=pass reason=100');
        // Microsoft omits the authserv-id, so the header cannot be matched to a trusted server.
        $this->assertNull($outlook);
    }

    public function test_verified_sender_with_dmarc_pass(): void
    {
        $check = (new ImipSenderAuthentication)->check($this->headers('mx.r.test; dmarc=pass header.from=example.com', 'Ann <ann@Example.com>'), 'MX.R.TEST');

        $this->assertTrue($check->ok());
        $this->assertSame('ann@example.com', $check->sender?->email);
    }

    public function test_dmarc_pass_for_another_domain_does_not_count(): void
    {
        $check = (new ImipSenderAuthentication)->check($this->headers('mx.r.test; dmarc=pass header.from=evil.test', 'ann@example.com'), 'mx.r.test');

        $this->assertFalse($check->ok());
    }

    public function test_subdomain_alignment_needs_a_two_label_parent(): void
    {
        $auth = new ImipSenderAuthentication;

        $this->assertTrue($auth->check($this->headers('mx.r.test; spf=pass smtp.mailfrom=bounce@mail.example.com', 'ann@example.com'), 'mx.r.test')->ok());
        $this->assertFalse($auth->check($this->headers('mx.r.test; dkim=pass header.d=com', 'ann@example.com'), 'mx.r.test')->ok());
        $this->assertFalse($auth->check($this->headers('mx.r.test; dkim=pass header.d=notexample.com', 'ann@example.com'), 'mx.r.test')->ok());
    }

    public function test_no_trusted_server_id_means_not_verified(): void
    {
        $check = (new ImipSenderAuthentication)->check($this->headers('mx.r.test; dmarc=pass header.from=example.com', 'ann@example.com'), '');

        $this->assertFalse($check->ok());
    }

    public function test_from_must_be_one_address(): void
    {
        foreach (['a@example.com, b@example.com', 'Group: a@example.com;', 'not an address', '"x, y" <a@example.com>, b@example.com'] as $from) {
            $this->assertNull(MailAddress::fromHeader($from), $from);
        }
        $this->assertSame('a@example.com', MailAddress::fromHeader('"Doe, Jane (Sales)" <A@Example.com>')?->email);
        $this->assertSame('Jürgen', MailAddress::fromHeader('=?UTF-8?Q?J=C3=BCrgen?= <j@example.com>')?->displayName);

        $twoFromHeaders = MailHeaders::parse("Authentication-Results: mx.r.test; dmarc=pass header.from=example.com\r\nFrom: a@example.com\r\nFrom: b@example.com\r\n");
        $this->assertFalse((new ImipSenderAuthentication)->check($twoFromHeaders, 'mx.r.test')->ok());
    }

    public function test_headers_unfold_and_keep_order(): void
    {
        $headers = MailHeaders::parse("Authentication-Results: top.test;\r\n  dmarc=pass\r\nAuthentication-Results: lower.test; none\r\nFrom: a@example.com\r\n");

        $this->assertSame(['top.test; dmarc=pass', 'lower.test; none'], $headers->all('authentication-results'));
    }

    private function headers(string $results, string $from): MailHeaders
    {
        return MailHeaders::parse('Authentication-Results: '.$results."\r\nFrom: ".$from."\r\n");
    }
}
