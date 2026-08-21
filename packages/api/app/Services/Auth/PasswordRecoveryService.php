<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Exceptions\ApiHttpException;
use App\Models\ApiPasswordResetToken;
use App\Models\Principal;
use App\Models\User;
use App\Services\MailDelivery\DeliveryResult;
use App\Services\MailDelivery\InvalidOutboundMessageException;
use App\Services\MailDelivery\MailDeliveryService;
use App\Services\Settings\UserProfileService;
use Illuminate\Support\Facades\Log;

final class PasswordRecoveryService
{
    public const int TOKEN_TTL_SECONDS = 15 * 60;

    public function __construct(
        private MailDeliveryService $mailDelivery,
        private PasswordResetMailFactory $resetMail,
        private PasswordRecoveryRateLimiter $rateLimiter,
        private UserProfileService $profiles,
        private RefreshTokenRepository $refreshTokens,
    ) {}

    public function requestReset(string $identifier, string $ip): void
    {
        if (! $this->rateLimiter->allow($identifier, $ip)) {
            throw new ApiHttpException(429, 'Too many password reset requests. Please try again later.', 'throttled');
        }

        $user = $this->resolveUser($identifier);
        if ($user === null) {
            return;
        }

        $email = $this->principalEmail((string) $user->username);
        if ($email === null || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            return;
        }

        $config = $this->mailDelivery->loadConfig();
        $canSubmit = (bool) ($this->mailDelivery->adminState()['capability']['canSubmit'] ?? false);
        if (! $canSubmit) {
            return;
        }

        $token = bin2hex(random_bytes(32));
        $this->replaceToken((string) $user->username, $token);
        $message = $this->resetMail->message($config->effectiveFrom(), $email, $token);

        try {
            $result = $this->mailDelivery->send($message, $config);
        } catch (InvalidOutboundMessageException) {
            ApiPasswordResetToken::query()->where('token_hash', hash('sha256', $token))->delete();

            return;
        }

        $this->logDelivery($result);
    }

    public function consumeReset(string $token, string $password): void
    {
        $token = trim($token);
        if ($token === '') {
            throw new ApiHttpException(400, 'This reset link is invalid or has expired.', 'bad_request');
        }

        $hash = hash('sha256', $token);
        $row = ApiPasswordResetToken::query()->where('token_hash', $hash)->first();
        if ($row === null || (int) $row->expires_at <= time()) {
            if ($row !== null) {
                $row->delete();
            }
            throw new ApiHttpException(400, 'This reset link is invalid or has expired.', 'bad_request');
        }

        $username = (string) $row->username;
        $this->profiles->updatePassword($username, $password);
        $this->refreshTokens->revokeAllForUsername($username);
        $row->delete();
    }

    private function resolveUser(string $identifier): ?User
    {
        $identifier = trim($identifier);
        if ($identifier === '') {
            return null;
        }

        $byUsername = User::query()->where('username', strtolower($identifier))->first();
        if ($byUsername !== null) {
            return $byUsername;
        }

        $principal = Principal::query()
            ->whereRaw('LOWER(email) = ?', [strtolower($identifier)])
            ->first();
        if ($principal === null) {
            return null;
        }

        $uri = (string) $principal->uri;
        if (! str_starts_with($uri, 'principals/') || str_starts_with($uri, 'principals/groups/')) {
            return null;
        }

        $username = substr($uri, strlen('principals/'));
        if ($username === '' || str_contains($username, '/')) {
            return null;
        }

        return User::query()->where('username', $username)->first();
    }

    private function principalEmail(string $username): ?string
    {
        $email = trim((string) (Principal::forUsername($username)?->email ?? ''));
        if ($email === '') {
            return null;
        }

        return $email;
    }

    private function replaceToken(string $username, string $token): void
    {
        ApiPasswordResetToken::query()->where('username', $username)->delete();
        ApiPasswordResetToken::query()->create([
            'token_hash' => hash('sha256', $token),
            'username' => $username,
            'expires_at' => time() + self::TOKEN_TTL_SECONDS,
        ]);
    }

    private function logDelivery(DeliveryResult $result): void
    {
        Log::info('password-recovery.delivery', $result->toArray());
    }
}
