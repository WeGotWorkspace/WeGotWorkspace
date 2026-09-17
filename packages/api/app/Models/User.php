<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * SabreDAV HTTP Basic user ({@code users} table).
 */
final class User extends Model
{
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
        'enabled',
    ];

    /** @var list<string> */
    protected $hidden = [
        'digest',
        'digesta1',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
        ];
    }

    public function isEnabled(): bool
    {
        return $this->enabled !== false;
    }

    public function principalUri(): string
    {
        return 'principals/'.$this->username;
    }

    public function principal(): ?Principal
    {
        return Principal::forUsername((string) $this->username);
    }
}
