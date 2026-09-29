<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Database\Factories\GroupMemberFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property int $principal_id
 * @property int $member_id
 */
final class GroupMember extends Model
{
    /** @use HasFactory<GroupMemberFactory> */
    use HasFactory;

    use UsesWgwConnection;

    protected $table = 'groupmembers';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'principal_id',
        'member_id',
    ];

    /** @return BelongsTo<Principal, $this> */
    public function group(): BelongsTo
    {
        return $this->belongsTo(Principal::class, 'principal_id');
    }

    /** @return BelongsTo<Principal, $this> */
    public function member(): BelongsTo
    {
        return $this->belongsTo(Principal::class, 'member_id');
    }
}
