<?php

declare(strict_types=1);

namespace App\Models;

use App\Auth\SabreUserProvider;
use App\Models\Concerns\UsesWgwConnection;
use App\Services\Auth\SabreCredentialValidator;
use Database\Factories\UserFactory;
use Illuminate\Contracts\Auth\Authenticatable as AuthenticatableContract;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Laravel\Passport\Contracts\OAuthenticatable;
use Laravel\Passport\HasApiTokens;

/**
 * SabreDAV HTTP Basic user ({@code users} table).
 *
 * Implements {@see AuthenticatableContract} so Passport/MCP can resolve
 * the same principal as Sabre digest auth. Password verification stays in
 * {@see SabreUserProvider} via {@see SabreCredentialValidator}.
 */
final class User extends Model implements AuthenticatableContract, OAuthenticatable
{
    use HasApiTokens;

    /** @use HasFactory<UserFactory> */
    use HasFactory;

    use UsesWgwConnection;

    protected $table = 'users';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'username',
        'digest',
        'digesta1',
    ];

    /** @var list<string> */
    protected $hidden = [
        'digest',
        'digesta1',
    ];

    public function principalUri(): string
    {
        return 'principals/'.$this->username;
    }

    public function principal(): ?Principal
    {
        return Principal::forUsername((string) $this->username);
    }

    public function getAuthIdentifierName(): string
    {
        return $this->getKeyName();
    }

    public function getAuthIdentifier(): mixed
    {
        return $this->getKey();
    }

    public function getAuthPasswordName(): string
    {
        return 'digest';
    }

    public function getAuthPassword(): string
    {
        return (string) $this->digest;
    }

    public function getRememberToken(): string
    {
        return '';
    }

    public function setRememberToken($value): void {}

    public function getRememberTokenName(): string
    {
        return '';
    }

    public function getProviderName(): string
    {
        return 'users';
    }
}
