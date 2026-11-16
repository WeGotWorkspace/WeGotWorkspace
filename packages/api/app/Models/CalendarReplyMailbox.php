<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use App\Services\Calendars\Imip\ImipMailboxSettings;
use Illuminate\Database\Eloquent\Model;

/**
 * The IMAP mailbox a user's invitation replies arrive in (#1589). Columns on
 * the wgw table; Larastan does not see `$this->wgw()` migrations.
 *
 * Read the password through {@see ImipMailboxSettings},
 * never from `password_enc` directly. Times are Unix seconds.
 *
 * @property string $username
 * @property string $host
 * @property int $port
 * @property string $security
 * @property string $login
 * @property string $password_enc
 * @property string $folder
 * @property string $trusted_server_id
 * @property bool $enabled
 * @property int|null $uidvalidity
 * @property int|null $last_uid
 * @property int|null $last_polled_at
 * @property int|null $last_success_at
 * @property string|null $last_error_code
 * @property int|null $last_error_at
 * @property int $auth_failures
 * @property int $updated_at
 */
final class CalendarReplyMailbox extends Model
{
    use UsesWgwConnection;

    protected $table = 'calendar_reply_mailboxes';

    protected $primaryKey = 'username';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'username',
        'host',
        'port',
        'security',
        'login',
        'password_enc',
        'folder',
        'trusted_server_id',
        'enabled',
        'uidvalidity',
        'last_uid',
        'last_polled_at',
        'last_success_at',
        'last_error_code',
        'last_error_at',
        'auth_failures',
        'updated_at',
    ];

    /** @var list<string> */
    protected $hidden = ['password_enc'];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'port' => 'integer',
            'enabled' => 'boolean',
            'uidvalidity' => 'integer',
            'last_uid' => 'integer',
            'last_polled_at' => 'integer',
            'last_success_at' => 'integer',
            'last_error_at' => 'integer',
            'auth_failures' => 'integer',
            'updated_at' => 'integer',
        ];
    }
}
