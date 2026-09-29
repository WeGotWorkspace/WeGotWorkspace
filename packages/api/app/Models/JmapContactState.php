<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $username
 * @property string $card_id
 * @property string $address_book_uri
 * @property string $card_uri
 * @property string $state_token
 * @property string|null $etag
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class JmapContactState extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_contact_states';

    protected $fillable = [
        'username',
        'card_id',
        'address_book_uri',
        'card_uri',
        'state_token',
        'etag',
    ];
}
