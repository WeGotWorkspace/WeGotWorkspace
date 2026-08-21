<?php

declare(strict_types=1);

namespace Tests\Unit\Services\Auth;

use App\Services\Auth\PasswordResetMailFactory;
use Illuminate\Http\Request;
use Tests\TestCase;

final class PasswordResetMailFactoryTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config([
            'wgw.public_web_url' => null,
            'wgw.vite_dev_port' => null,
        ]);
    }

    public function test_message_uses_configured_from_to_and_reset_link(): void
    {
        $request = Request::create('http://workspace.test/api/v1/auth/password-resets', 'POST');
        $this->app->instance('request', $request);
        $factory = $this->app->make(PasswordResetMailFactory::class);
        $token = str_repeat('ab', 32);

        $message = $factory->message('ops@example.test', 'alice@example.test', $token);

        $this->assertSame('ops@example.test', $message->from);
        $this->assertSame(['alice@example.test'], $message->to);
        $this->assertSame('Reset your WeGotWorkspace password', $message->subject);
        $this->assertStringContainsString('http://workspace.test/login/reset?token='.$token, $message->textBody);
        $this->assertStringContainsString('does not mean it reached an inbox', $message->textBody);
    }

    public function test_reset_link_uses_public_web_base_instead_of_api_bind(): void
    {
        config(['wgw.public_web_url' => 'http://localhost:5194']);
        $request = Request::create('http://127.0.0.1:9080/api/v1/auth/password-resets', 'POST');
        $this->app->instance('request', $request);
        $factory = $this->app->make(PasswordResetMailFactory::class);
        $token = str_repeat('cd', 32);

        $message = $factory->message('ops@example.test', 'alice@example.test', $token);

        $this->assertStringContainsString('http://localhost:5194/login/reset?token='.$token, $message->textBody);
        $this->assertStringNotContainsString('127.0.0.1:9080', $message->textBody);
    }

    public function test_reset_link_uses_vite_dev_port_when_request_is_api_bind(): void
    {
        config(['wgw.vite_dev_port' => 5194]);
        $request = Request::create('http://127.0.0.1:9080/api/v1/auth/password-resets', 'POST');
        $this->app->instance('request', $request);
        $factory = $this->app->make(PasswordResetMailFactory::class);
        $token = str_repeat('ef', 32);

        $message = $factory->message('ops@example.test', 'alice@example.test', $token);

        $this->assertStringContainsString('http://localhost:5194/login/reset?token='.$token, $message->textBody);
    }
}
