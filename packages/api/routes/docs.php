<?php

declare(strict_types=1);

use App\Http\Controllers\Api\ApiDocsController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| OpenAPI browser + spec (outside /api/v1 REST prefix)
|--------------------------------------------------------------------------
*/

Route::middleware('web')->prefix('api')->name('api.docs.')->group(function (): void {
    Route::get('openapi.json', [ApiDocsController::class, 'openApi'])->name('openapi');
    Route::get('docs', [ApiDocsController::class, 'ui'])->name('ui');
    Route::get('docs/{asset}', [ApiDocsController::class, 'asset'])
        ->where('asset', 'swagger-ui\.css|swagger-ui-bundle\.js|swagger-ui-standalone-preset\.js|swagger-init\.js|favicon-32x32\.png|favicon-16x16\.png')
        ->name('asset');
});
