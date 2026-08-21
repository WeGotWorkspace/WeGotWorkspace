<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

final class ApiPasswordResetToken extends Model
{
    use UsesWgwConnection;

    protected $table = 'api_password_reset_tokens';

    protected $primaryKey = 'token_hash';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'token_hash',
        'username',
        'expires_at',
    ];
}
