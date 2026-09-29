<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Database\Factories\PrincipalFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $uri
 * @property string|null $email
 * @property string|null $displayname
 */
final class Principal extends Model
{
    /** @use HasFactory<PrincipalFactory> */
    use HasFactory;

    use UsesWgwConnection;

    protected $table = 'principals';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'uri',
        'email',
        'displayname',
    ];

    /** @return HasMany<GroupMember, $this> */
    public function groupMemberships(): HasMany
    {
        return $this->hasMany(GroupMember::class, 'member_id');
    }

    /** @return BelongsToMany<Principal, $this> */
    public function groupMembers(): BelongsToMany
    {
        return $this->belongsToMany(
            self::class,
            'groupmembers',
            'principal_id',
            'member_id'
        );
    }

    public static function forUsername(string $username): ?self
    {
        return self::query()->where('uri', 'principals/'.$username)->first();
    }
}
